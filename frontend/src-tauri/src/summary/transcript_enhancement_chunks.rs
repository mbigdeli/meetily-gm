//! Lossless transcript splitting for bounded-context enhancement calls.

pub(super) fn split_transcript(text: &str, max_chars: usize) -> Vec<&str> {
    if text.is_empty() || text.chars().count() <= max_chars {
        return vec![text];
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let remaining = &text[start..];
        let hard_end = remaining
            .char_indices()
            .nth(max_chars)
            .map_or(text.len(), |(offset, _)| start + offset);
        if hard_end == text.len() {
            chunks.push(remaining);
            break;
        }

        let window = &text[start..hard_end];
        let minimum = window.len() / 2;
        let preferred = ['\n', '.', '؟', '!', '?', ' ']
            .into_iter()
            .find_map(|delimiter| {
                window.rfind(delimiter).and_then(|position| {
                    (position >= minimum).then_some(position + delimiter.len_utf8())
                })
            });
        let end = start + preferred.unwrap_or(window.len());
        chunks.push(&text[start..end]);
        start = end;
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splitting_is_lossless_and_unicode_safe() {
        let text = "سلام دنیا. این یک جلسه فارسی است.\nNext speaker: hello world.";
        let chunks = split_transcript(text, 14);
        assert!(chunks.len() > 1);
        assert_eq!(chunks.concat(), text);
    }

    #[test]
    fn short_text_stays_in_one_chunk() {
        assert_eq!(split_transcript("short", 20), vec!["short"]);
    }
}
