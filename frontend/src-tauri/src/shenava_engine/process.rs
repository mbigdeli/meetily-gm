use anyhow::{anyhow, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

pub struct ShenavaProcess {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl ShenavaProcess {
    pub async fn start(model_dir: &Path) -> Result<Self> {
        let mut child = Command::new(helper_path()?)
            .arg(model_dir.join("model.onnx"))
            .arg(model_dir.join("tokens.txt"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .context("failed to start isolated Shenava engine")?;
        let stdin = child.stdin.take().context("Shenava helper stdin unavailable")?;
        let stdout = child.stdout.take().context("Shenava helper stdout unavailable")?;
        let mut process = Self {
            _child: child,
            stdin,
            stdout: BufReader::new(stdout),
        };
        let mut ready = String::new();
        process.stdout.read_line(&mut ready).await?;
        if ready.trim() != "READY" {
            return Err(anyhow!("Shenava helper failed to load model: {}", ready.trim()));
        }
        Ok(process)
    }

    pub async fn transcribe(&mut self, samples: &[f32]) -> Result<String> {
        self.stdin
            .write_all(&(samples.len() as u32).to_le_bytes())
            .await?;
        let bytes = samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect::<Vec<_>>();
        self.stdin.write_all(&bytes).await?;
        self.stdin.flush().await?;
        let size = self.stdout.read_u32_le().await? as usize;
        if size > 16 * 1024 * 1024 {
            return Err(anyhow!("invalid response from Shenava helper"));
        }
        let mut response = vec![0_u8; size];
        self.stdout.read_exact(&mut response).await?;
        String::from_utf8(response).context("Shenava returned invalid UTF-8")
    }
}

fn helper_path() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("SHENAVA_HELPER_PATH").map(PathBuf::from) {
        return existing_helper(path);
    }
    let adjacent = std::env::current_exe()?
        .parent()
        .context("application executable has no parent")?
        .join(helper_name());
    if adjacent.is_file() {
        return Ok(adjacent);
    }
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("shenava-helper/target/debug")
        .join(helper_name());
    existing_helper(workspace)
}

fn existing_helper(path: PathBuf) -> Result<PathBuf> {
    path.is_file()
        .then_some(path.clone())
        .ok_or_else(|| anyhow!("Shenava helper was not built: {}", path.display()))
}

fn helper_name() -> &'static str {
    if cfg!(windows) {
        "shenava-helper.exe"
    } else {
        "shenava-helper"
    }
}
