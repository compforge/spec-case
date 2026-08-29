use serde::Deserialize;
use serde_json::Value;
use spec_case::{extract_file, Entry};
use std::fs;
use std::path::PathBuf;

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<ConformanceCase>,
}

#[derive(Deserialize)]
struct ConformanceCase {
    name: String,
    source: RustSource,
    symbol: RustSymbol,
    expected_entry: Option<Value>,
}

#[derive(Deserialize)]
struct RustSource {
    rust: String,
}

#[derive(Deserialize)]
struct RustSymbol {
    rust: String,
}

#[test]
fn shared_conformance() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../conformance/specgen/cases.json");
    let fixture: Fixture = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    for case in fixture.cases {
        let out = extract_file(&case.source.rust, "fixture.rs").unwrap();
        let actual: Option<&Entry> = out.get(&case.symbol.rust);
        match case.expected_entry {
            Some(expected) => assert_eq!(
                serde_json::to_value(actual.expect(&case.name)).unwrap(),
                expected,
                "{}",
                case.name
            ),
            None => assert!(actual.is_none(), "{}: unexpected entry", case.name),
        }
    }
}
