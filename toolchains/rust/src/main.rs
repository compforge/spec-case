use spec_case::{extract_tree, Entry, SpecIndex};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

struct Options {
    source: PathBuf,
    root: PathBuf,
    output: String,
    check: bool,
}

fn main() -> ExitCode {
    match run(env::args().skip(1).collect()) {
        Ok(code) => ExitCode::from(code),
        Err(error) => {
            eprintln!("specgen: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: Vec<String>) -> Result<u8, Box<dyn std::error::Error>> {
    if matches!(args.as_slice(), [arg] if matches!(arg.as_str(), "-h" | "--help")) {
        println!("usage: specgen [-o spec.json] [--root <repo-root>] [--check] <src-dir>");
        return Ok(0);
    }
    let options = match parse_args(&args) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("{error}");
            eprintln!("usage: specgen [-o spec.json] [--root <repo-root>] [--check] <src-dir>");
            return Ok(2);
        }
    };
    let index = extract_tree(&options.source, &options.root)?;
    if options.check {
        return Ok(check(&options.output, &index));
    }
    let data = canonical(&index)?;
    if options.output == "-" {
        print!("{data}");
    } else {
        fs::write(&options.output, data)?;
        eprintln!("specgen: {} symbol(s) -> {}", index.len(), options.output);
    }
    Ok(0)
}

fn parse_args(args: &[String]) -> Result<Options, String> {
    let mut output = "-".to_owned();
    let mut root = None;
    let mut source = None;
    let mut check = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "-o" | "--output" => {
                index += 1;
                output = args.get(index).cloned().ok_or("missing value for -o")?;
            }
            "-root" | "--root" => {
                index += 1;
                root = Some(PathBuf::from(
                    args.get(index).ok_or("missing value for --root")?,
                ));
            }
            "-check" | "--check" => check = true,
            value if value.starts_with('-') => return Err(format!("unknown option: {value}")),
            value if source.is_none() => source = Some(PathBuf::from(value)),
            value => return Err(format!("unexpected argument: {value}")),
        }
        index += 1;
    }
    let source = source.ok_or("missing <src-dir>")?;
    Ok(Options {
        root: root.unwrap_or_else(|| source.clone()),
        source,
        output,
        check,
    })
}

fn canonical(index: &SpecIndex) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(index).map(|json| format!("{json}\n"))
}

fn check(output: &str, fresh: &SpecIndex) -> u8 {
    if output == "-" {
        eprintln!("specgen --check needs -o <spec.json>");
        return 2;
    }
    let committed: SpecIndex = match fs::read_to_string(output)
        .map_err(|error| error.to_string())
        .and_then(|data| serde_json::from_str(&data).map_err(|error| error.to_string()))
    {
        Ok(index) => index,
        Err(error) => {
            eprintln!("specgen --check: {output} cannot be read as JSON: {error}");
            return 1;
        }
    };
    if committed == *fresh {
        eprintln!(
            "specgen --check: {output} is up to date ({} symbol(s))",
            fresh.len()
        );
        return 0;
    }

    eprintln!("specgen --check: {output} is out of date — run specgen to regenerate:");
    report_drift(&committed, fresh);
    1
}

fn report_drift(committed: &BTreeMap<String, Entry>, fresh: &BTreeMap<String, Entry>) {
    let committed_ids: BTreeSet<_> = committed.keys().collect();
    let fresh_ids: BTreeSet<_> = fresh.keys().collect();
    for id in fresh_ids.difference(&committed_ids) {
        eprintln!("  + {id}  (marked in code, missing from spec.json)");
    }
    for id in committed_ids.difference(&fresh_ids) {
        eprintln!("  - {id}  (in spec.json, but no such marked symbol — renamed/removed)");
    }
    for id in fresh_ids.intersection(&committed_ids) {
        if committed.get(*id) != fresh.get(*id) {
            eprintln!("  ~ {id}  (markers changed)");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_go_and_gnu_style_options() {
        let args = ["-root", ".", "--check", "-o", "spec.json", "src"].map(str::to_owned);
        let options = parse_args(&args).unwrap();
        assert_eq!(options.source, PathBuf::from("src"));
        assert_eq!(options.root, PathBuf::from("."));
        assert_eq!(options.output, "spec.json");
        assert!(options.check);
    }
}
