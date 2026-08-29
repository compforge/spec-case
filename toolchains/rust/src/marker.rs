//! Parser for the language-neutral marker vocabulary as authored in Rust doc comments.

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MarkerCase {
    pub id: String,
    pub desc: String,
    pub input: String,
    pub expect: String,
    pub forbid: String,
    pub group: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MarkerDocument {
    pub spec_id: Option<String>,
    pub spec: String,
    pub cases: Vec<MarkerCase>,
    pub whys: Vec<String>,
    pub ideals: Vec<String>,
    pub links: Vec<String>,
    pub rules: Vec<String>,
}

pub fn parse_markers(doc: &str) -> MarkerDocument {
    let mut out = MarkerDocument::default();
    for raw in doc.lines() {
        let line = raw.trim().trim_start_matches("///").trim();
        let line = line.strip_prefix('*').unwrap_or(line).trim();
        if let Some(body) = line.strip_prefix("+spec:") {
            let args = parse_args(body);
            out.spec_id = args
                .iter()
                .find(|(key, _)| key == "id")
                .map(|(_, value)| value.clone());
            out.spec = arg(&args, "text").unwrap_or_default();
        } else if let Some(value) = line.strip_prefix("+spec=") {
            out.spec = unquote(value);
        } else if let Some(body) = line.strip_prefix("+case:") {
            let args = parse_args(body);
            let id = arg(&args, "id").unwrap_or_default();
            if !valid_id(&id) {
                continue;
            }
            out.cases.push(MarkerCase {
                id,
                desc: arg(&args, "desc").unwrap_or_default(),
                input: arg(&args, "input").unwrap_or_default(),
                expect: arg(&args, "expect").unwrap_or_default(),
                forbid: arg(&args, "forbid").unwrap_or_default(),
                group: arg(&args, "group").unwrap_or_default(),
            });
        } else if let Some(value) = line.strip_prefix("+why=") {
            push_nonempty(&mut out.whys, unquote(value));
        } else if let Some(value) = line.strip_prefix("+ideal=") {
            push_nonempty(&mut out.ideals, unquote(value));
        } else if let Some(value) = line.strip_prefix("+link=") {
            let value = unquote(value);
            if valid_link_ref(&value) {
                out.links.push(value);
            }
        } else if let Some(value) = line.strip_prefix("+rule=") {
            push_nonempty(&mut out.rules, unquote(value));
        }
    }
    out
}

pub(crate) fn valid_id(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some('a'..='z'))
        && chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
}

fn push_nonempty(target: &mut Vec<String>, value: String) {
    if !value.is_empty() {
        target.push(value);
    }
}

fn arg(args: &[(String, String)], key: &str) -> Option<String> {
    args.iter()
        .rev()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.clone())
}

fn parse_args(source: &str) -> Vec<(String, String)> {
    let bytes = source.as_bytes();
    let mut out = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        while index < bytes.len() && (bytes[index] == b',' || bytes[index].is_ascii_whitespace()) {
            index += 1;
        }
        let key_start = index;
        while index < bytes.len() && bytes[index] != b'=' {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }
        let key = source[key_start..index].trim();
        index += 1;

        let value = if index < bytes.len() && matches!(bytes[index], b'`' | b'"') {
            let quote = bytes[index];
            index += 1;
            let value_start = index;
            while index < bytes.len() && bytes[index] != quote {
                index += 1;
            }
            let value = source[value_start..index].to_owned();
            if index < bytes.len() {
                index += 1;
            }
            value
        } else {
            let value_start = index;
            while index < bytes.len() && bytes[index] != b',' {
                index += 1;
            }
            source[value_start..index].trim().to_owned()
        };
        if !key.is_empty() {
            out.push((key.to_owned(), value));
        }
    }
    out
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        if matches!(bytes[0], b'`' | b'"') && bytes[0] == bytes[value.len() - 1] {
            return value[1..value.len() - 1].to_owned();
        }
    }
    value.to_owned()
}

fn valid_link_ref(reference: &str) -> bool {
    let target = ["repo://", "component://"]
        .iter()
        .find_map(|prefix| reference.strip_prefix(prefix));
    let Some(target) = target else {
        return false;
    };
    if target.is_empty()
        || target.starts_with('/')
        || target.contains('\\')
        || target.chars().any(char::is_whitespace)
    {
        return false;
    }
    let (path, symbol) = target
        .split_once("::")
        .map_or((target, None), |(path, symbol)| (path, Some(symbol)));
    if path
        .split('/')
        .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
    {
        return false;
    }
    symbol.is_none_or(|symbol| {
        !symbol.is_empty() && !symbol.chars().any(|ch| matches!(ch, ':' | '/' | '\\'))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_marker_vocabulary() {
        let parsed = parse_markers(
            "/// +spec:id=happy_path,text=`does useful work`\n\
             /// +case:id=happy,desc=`works, even with commas`,expect=`ok`\n\
             /// +why=`one owner preserves ordering`\n\
             /// +ideal=`one scheduler owns capacity`\n\
             /// +link=component://src/peer.rs::Peer.sync\n\
             /// +rule=`preserve ordering`",
        );
        assert_eq!(parsed.spec_id.as_deref(), Some("happy_path"));
        assert_eq!(parsed.spec, "does useful work");
        assert_eq!(parsed.cases[0].desc, "works, even with commas");
        assert_eq!(parsed.whys, ["one owner preserves ordering"]);
        assert_eq!(parsed.ideals, ["one scheduler owns capacity"]);
        assert_eq!(parsed.links, ["component://src/peer.rs::Peer.sync"]);
        assert_eq!(parsed.rules, ["preserve ordering"]);
    }

    #[test]
    fn rejects_invalid_case_ids_and_link_refs() {
        let parsed = parse_markers(
            "+case:id=Bad-ID,desc=`invalid`\n\
             +link=../../docs/design.md\n\
             +link=component://../../docs/design.md",
        );
        assert!(parsed.cases.is_empty());
        assert!(parsed.links.is_empty());
    }
}
