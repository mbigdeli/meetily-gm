use std::pin::Pin;
use std::task::{Context, Poll};
use futures_util::{Stream, StreamExt};
use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait};


#[cfg(target_os = "macos")]
use futures_channel::mpsc;
#[cfg(target_os = "macos")]
use super::core_audio::CoreAudioCapture;
#[cfg(target_os = "macos")]
use log::info;

#[cfg(target_os = "windows")]
use futures_channel::mpsc as win_mpsc;
#[cfg(target_os = "windows")]
use cpal::traits::StreamTrait;
#[cfg(target_os = "windows")]
use log::{info, warn};

/// System audio capture using Core Audio tap (macOS) or CPAL (other platforms)
pub struct SystemAudioCapture {
    _host: cpal::Host,
}

impl SystemAudioCapture {
    pub fn new() -> Result<Self> {
        let host = cpal::default_host();
        Ok(Self { _host: host })
    }

    pub fn list_system_devices() -> Result<Vec<String>> {
        let host = cpal::default_host();
        let devices = host.output_devices()
            .map_err(|e| anyhow::anyhow!("Failed to enumerate output devices: {}", e))?;

        let mut device_names = Vec::new();
        for device in devices {
            if let Ok(name) = device.name() {
                device_names.push(name);
            }
        }

        Ok(device_names)
    }

    pub fn start_system_audio_capture(&self) -> Result<SystemAudioStream> {
        #[cfg(target_os = "macos")]
        {
            info!("Starting Core Audio system capture (macOS)");
            // Use Core Audio tap for system audio capture
            let core_audio = CoreAudioCapture::new()?;
            let core_audio_stream = core_audio.stream()?;
            let sample_rate = core_audio_stream.sample_rate();

            // Convert CoreAudioStream to SystemAudioStream
            let (tx, rx) = mpsc::unbounded::<Vec<f32>>();
            let (drop_tx, drop_rx) = std::sync::mpsc::channel::<()>();

            // Spawn task to forward Core Audio samples
            tokio::spawn(async move {
                use futures_util::StreamExt;
                let mut stream = core_audio_stream;
                let mut buffer = Vec::new();
                let chunk_size = 1024;

                loop {
                    // Check if we should stop
                    if drop_rx.try_recv().is_ok() {
                        break;
                    }

                    // Poll the Core Audio stream
                    match stream.next().await {
                        Some(sample) => {
                            buffer.push(sample);
                            if buffer.len() >= chunk_size {
                                if tx.unbounded_send(buffer.clone()).is_err() {
                                    break;
                                }
                                buffer.clear();
                            }
                        }
                        None => break,
                    }
                }

                // Send any remaining samples
                if !buffer.is_empty() {
                    let _ = tx.unbounded_send(buffer);
                }
            });

            let receiver = rx.map(futures_util::stream::iter).flatten();

            info!("Core Audio system capture started successfully");

            Ok(SystemAudioStream {
                drop_tx,
                sample_rate,
                receiver: Box::pin(receiver),
            })
        }

        #[cfg(target_os = "windows")]
        {
            // WASAPI loopback: cpal transparently enables loopback capture when an
            // input stream is built on an *output* (render) device, so we capture
            // whatever is playing on the speakers (the far side of any meeting).
            //
            // A cpal Stream is `!Send`, so it must be created and kept alive on a
            // dedicated thread; that thread forwards f32 samples over a channel that
            // this SystemAudioStream drains (same shape as the macOS Core Audio path).
            info!("Starting WASAPI loopback system capture (Windows)");

            let (tx, rx) = win_mpsc::unbounded::<Vec<f32>>();
            let (drop_tx, drop_rx) = std::sync::mpsc::channel::<()>();
            let (rate_tx, rate_rx) = std::sync::mpsc::channel::<Result<u32, String>>();

            std::thread::spawn(move || {
                let build = || -> Result<(cpal::Stream, u32)> {
                    let host = cpal::default_host();
                    let device = host
                        .default_output_device()
                        .ok_or_else(|| anyhow::anyhow!("no default output device for loopback"))?;
                    let supported = device
                        .default_output_config()
                        .map_err(|e| anyhow::anyhow!("default_output_config failed: {}", e))?;
                    let sample_rate = supported.sample_rate().0;
                    let sample_format = supported.sample_format();
                    let config: cpal::StreamConfig = supported.into();

                    let err_fn = |e| {
                        warn!("WASAPI loopback stream error: {}", e);
                    };

                    // Build an input stream on the render device -> loopback capture.
                    // Convert every supported sample format to f32 (matches the rest
                    // of meetily's capture pipeline).
                    let stream = match sample_format {
                        cpal::SampleFormat::F32 => {
                            let tx = tx.clone();
                            device.build_input_stream(
                                &config,
                                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                                    let _ = tx.unbounded_send(data.to_vec());
                                },
                                err_fn,
                                None,
                            )
                        }
                        cpal::SampleFormat::I16 => {
                            let tx = tx.clone();
                            device.build_input_stream(
                                &config,
                                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                                    let f: Vec<f32> =
                                        data.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                                    let _ = tx.unbounded_send(f);
                                },
                                err_fn,
                                None,
                            )
                        }
                        cpal::SampleFormat::I32 => {
                            let tx = tx.clone();
                            device.build_input_stream(
                                &config,
                                move |data: &[i32], _: &cpal::InputCallbackInfo| {
                                    let f: Vec<f32> =
                                        data.iter().map(|&s| s as f32 / i32::MAX as f32).collect();
                                    let _ = tx.unbounded_send(f);
                                },
                                err_fn,
                                None,
                            )
                        }
                        cpal::SampleFormat::U8 => {
                            let tx = tx.clone();
                            device.build_input_stream(
                                &config,
                                move |data: &[u8], _: &cpal::InputCallbackInfo| {
                                    let f: Vec<f32> = data
                                        .iter()
                                        .map(|&s| (s as f32 - 128.0) / 128.0)
                                        .collect();
                                    let _ = tx.unbounded_send(f);
                                },
                                err_fn,
                                None,
                            )
                        }
                        other => {
                            return Err(anyhow::anyhow!(
                                "unsupported loopback sample format: {:?}",
                                other
                            ))
                        }
                    }
                    .map_err(|e| anyhow::anyhow!("build loopback input stream: {}", e))?;

                    stream
                        .play()
                        .map_err(|e| anyhow::anyhow!("play loopback stream: {}", e))?;
                    Ok((stream, sample_rate))
                };

                match build() {
                    Ok((stream, sample_rate)) => {
                        let _ = rate_tx.send(Ok(sample_rate));
                        // Keep the (!Send) stream alive on this thread until the
                        // SystemAudioStream is dropped (which drops drop_tx).
                        let _ = drop_rx.recv();
                        drop(stream);
                        info!("WASAPI loopback capture stopped");
                    }
                    Err(e) => {
                        let _ = rate_tx.send(Err(e.to_string()));
                    }
                }
            });

            let sample_rate = rate_rx
                .recv()
                .map_err(|_| anyhow::anyhow!("loopback capture thread exited before init"))?
                .map_err(|e| anyhow::anyhow!("failed to start loopback capture: {}", e))?;

            let receiver = rx.map(futures_util::stream::iter).flatten();
            info!("WASAPI loopback capture started ({} Hz)", sample_rate);

            Ok(SystemAudioStream {
                drop_tx,
                sample_rate,
                receiver: Box::pin(receiver),
            })
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            // Linux/other: ALSA/PulseAudio loopback not yet implemented.
            anyhow::bail!("System audio capture not yet implemented for this platform")
        }
    }

    pub fn check_system_audio_permissions() -> bool {
        // Check if we can enumerate audio devices
        match cpal::default_host().output_devices() {
            Ok(_) => true,
            Err(_) => false,
        }
    }
}

pub struct SystemAudioStream {
    drop_tx: std::sync::mpsc::Sender<()>,
    sample_rate: u32,
    receiver: Pin<Box<dyn Stream<Item = f32> + Send + Sync>>,
}

impl Drop for SystemAudioStream {
    fn drop(&mut self) {
        let _ = self.drop_tx.send(());
    }
}

impl Stream for SystemAudioStream {
    type Item = f32;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.receiver.as_mut().poll_next_unpin(cx)
    }
}

impl SystemAudioStream {
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
}

/// Public interface for system audio capture
pub async fn start_system_audio_capture() -> Result<SystemAudioStream> {
    let capture = SystemAudioCapture::new()?;
    capture.start_system_audio_capture()
}

pub fn list_system_audio_devices() -> Result<Vec<String>> {
    SystemAudioCapture::list_system_devices()
}

pub fn check_system_audio_permissions() -> bool {
    SystemAudioCapture::check_system_audio_permissions()
}