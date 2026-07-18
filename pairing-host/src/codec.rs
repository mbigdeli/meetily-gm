//! Chrome native-messaging frame codec: 4-byte little-endian length + JSON.

use std::io::{self, Read, Write};

/// Refuse absurd frames (Chrome caps host->browser at 1 MiB anyway).
const MAX_FRAME_BYTES: u32 = 1024 * 1024;

/// Read one length-prefixed JSON message. `Ok(None)` on clean EOF.
pub fn read_message<R: Read>(input: &mut R) -> io::Result<Option<serde_json::Value>> {
    let mut len_buf = [0u8; 4];
    match input.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_le_bytes(len_buf);
    if len == 0 || len > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("frame length {len} out of range"),
        ));
    }
    let mut payload = vec![0u8; len as usize];
    input.read_exact(&mut payload)?;
    serde_json::from_slice(&payload)
        .map(Some)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

/// Write one length-prefixed JSON message and flush.
pub fn write_message<W: Write>(output: &mut W, message: &serde_json::Value) -> io::Result<()> {
    let payload = serde_json::to_vec(message)?;
    let len = u32::try_from(payload.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "frame too large"))?;
    output.write_all(&len.to_le_bytes())?;
    output.write_all(&payload)?;
    output.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trips_a_message() {
        let msg = json!({"action": "pairing.get", "n": 7});
        let mut buf = Vec::new();
        write_message(&mut buf, &msg).unwrap();
        let mut cursor = std::io::Cursor::new(buf);
        let back = read_message(&mut cursor).unwrap().unwrap();
        assert_eq!(back, msg);
        assert!(read_message(&mut cursor).unwrap().is_none(), "clean EOF after one frame");
    }

    #[test]
    fn rejects_oversized_frame_length() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&(MAX_FRAME_BYTES + 1).to_le_bytes());
        buf.extend_from_slice(b"{}");
        let err = read_message(&mut std::io::Cursor::new(buf)).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
    }

    #[test]
    fn eof_mid_frame_is_an_error_not_none() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&8u32.to_le_bytes());
        buf.extend_from_slice(b"{\"a\"");
        let err = read_message(&mut std::io::Cursor::new(buf)).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::UnexpectedEof);
    }
}
