use std::fs;
use std::process::Command;

#[test]
fn generates_and_checks_spec_json() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("src");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("lib.rs"), "/// +spec=`contract`\nfn run() {}\n").unwrap();
    let output = temp.path().join("spec.json");
    let binary = env!("CARGO_BIN_EXE_specgen");

    let generate = Command::new(binary)
        .current_dir(temp.path())
        .args(["--root", ".", "-o"])
        .arg(&output)
        .arg("src")
        .output()
        .unwrap();
    assert!(generate.status.success(), "{:?}", generate);
    let json = fs::read_to_string(&output).unwrap();
    assert!(json.contains("src/lib.rs::run"));

    let check = Command::new(binary)
        .current_dir(temp.path())
        .args(["--root", ".", "--check", "-o"])
        .arg(&output)
        .arg("src")
        .output()
        .unwrap();
    assert!(check.status.success(), "{:?}", check);

    fs::write(
        source.join("lib.rs"),
        "/// +spec=`changed contract`\nfn run() {}\n",
    )
    .unwrap();
    let drift = Command::new(binary)
        .current_dir(temp.path())
        .args(["--root", ".", "--check", "-o"])
        .arg(&output)
        .arg("src")
        .output()
        .unwrap();
    assert_eq!(drift.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&drift.stderr).contains("markers changed"));
}

#[test]
fn help_is_successful() {
    let output = Command::new(env!("CARGO_BIN_EXE_specgen"))
        .arg("--help")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("usage: specgen"));
}
