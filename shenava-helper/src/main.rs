use anyhow::{anyhow, Context, Result};
use sherpa_onnx::{
    OfflineNemoEncDecCtcModelConfig, OfflineRecognizer, OfflineRecognizerConfig,
};
use std::io::{self, BufReader, BufWriter, Read, Write};

const MAX_SAMPLES: usize = 16_000 * 60 * 10;
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;

fn main() -> Result<()> {
    let (model, tokens) = arguments()?;
    let recognizer = create_recognizer(model, tokens)?;
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut input = BufReader::new(stdin.lock());
    let mut output = BufWriter::new(stdout.lock());
    output.write_all(b"READY\n")?;
    output.flush()?;

    loop {
        let sample_count = match read_u32_or_eof(&mut input)? {
            Some(value) => value as usize,
            None => break,
        };
        if sample_count > MAX_SAMPLES {
            return Err(anyhow!("audio request is too large: {sample_count} samples"));
        }
        let mut bytes = vec![0_u8; sample_count * 4];
        input.read_exact(&mut bytes)?;
        let samples = bytes
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes(chunk.try_into().expect("four bytes")))
            .collect::<Vec<_>>();
        let text = transcribe(&recognizer, &samples)?;
        let response = text.as_bytes();
        if response.len() > MAX_RESPONSE_BYTES {
            return Err(anyhow!("transcription response is too large"));
        }
        output.write_all(&(response.len() as u32).to_le_bytes())?;
        output.write_all(response)?;
        output.flush()?;
    }
    Ok(())
}

fn arguments() -> Result<(String, String)> {
    let mut args = std::env::args().skip(1);
    let model = args.next().context("missing model.onnx path")?;
    let tokens = args.next().context("missing tokens.txt path")?;
    Ok((model, tokens))
}

fn create_recognizer(model: String, tokens: String) -> Result<OfflineRecognizer> {
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.nemo_ctc = OfflineNemoEncDecCtcModelConfig {
        model: Some(model),
    };
    config.model_config.tokens = Some(tokens);
    config.model_config.num_threads = 4;
    config.decoding_method = Some("greedy_search".into());
    OfflineRecognizer::create(&config).ok_or_else(|| anyhow!("could not load Shenava model"))
}

fn transcribe(recognizer: &OfflineRecognizer, samples: &[f32]) -> Result<String> {
    let stream = recognizer.create_stream();
    stream.accept_waveform(16_000, samples);
    recognizer.decode(&stream);
    stream
        .get_result()
        .map(|result| result.text)
        .ok_or_else(|| anyhow!("Shenava returned no transcription result"))
}

fn read_u32_or_eof(reader: &mut impl Read) -> Result<Option<u32>> {
    let mut bytes = [0_u8; 4];
    match reader.read_exact(&mut bytes) {
        Ok(()) => Ok(Some(u32::from_le_bytes(bytes))),
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => Ok(None),
        Err(error) => Err(error.into()),
    }
}
