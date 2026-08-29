use crate::marker::{parse_markers, valid_id, MarkerDocument};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use syn::{Attribute, ImplItem, Item, TraitItem, Type};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Case {
    pub id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub desc: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub input: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub expect: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub forbid: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Spec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub spec: String,
    #[serde(default)]
    pub cases: Vec<Case>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub whys: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ideals: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rules: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fqn: Option<String>,
    pub specs: Vec<Spec>,
}

pub type SpecIndex = BTreeMap<String, Entry>;

#[derive(Debug)]
pub enum ExtractError {
    Io(std::io::Error),
    InvalidSpecId { symbol_id: String, spec_id: String },
    AmbiguousSymbol { symbol_id: String },
    DuplicateSpecId { symbol_id: String, spec_id: String },
}

impl fmt::Display for ExtractError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => error.fmt(f),
            Self::InvalidSpecId { symbol_id, spec_id } => {
                write!(f, "invalid spec id {spec_id:?} for {symbol_id:?}")
            }
            Self::AmbiguousSymbol { symbol_id } => write!(
                f,
                "multiple marked declarations resolve to {symbol_id:?}; each +spec must set a unique id"
            ),
            Self::DuplicateSpecId { symbol_id, spec_id } => {
                write!(f, "duplicate spec id {spec_id:?} for {symbol_id:?}")
            }
        }
    }
}

impl std::error::Error for ExtractError {}

impl From<std::io::Error> for ExtractError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

pub fn extract_file(source: &str, relpath: &str) -> Result<SpecIndex, ExtractError> {
    let Ok(file) = syn::parse_file(source) else {
        return Ok(SpecIndex::new());
    };
    let mut out = SpecIndex::new();
    visit_items(&file.items, &[], relpath, &mut out)?;
    Ok(out)
}

pub fn extract_tree(source_root: &Path, repository_root: &Path) -> Result<SpecIndex, ExtractError> {
    let mut files = Vec::new();
    source_files(source_root, &mut files)?;
    files.sort();

    let mut out = SpecIndex::new();
    for path in files {
        let Ok(source) = fs::read_to_string(&path) else {
            continue;
        };
        let Some(relpath) = relative_path(&path, repository_root) else {
            continue;
        };
        for (symbol_id, entry) in extract_file(&source, &relpath)? {
            merge_entry(&mut out, symbol_id, entry)?;
        }
    }
    Ok(out)
}

fn visit_items(
    items: &[Item],
    stack: &[String],
    relpath: &str,
    out: &mut SpecIndex,
) -> Result<(), ExtractError> {
    for item in items {
        match item {
            Item::Fn(item) => emit(
                out,
                relpath,
                qualified(stack, &item.sig.ident.to_string()),
                entry_for(&item.attrs),
            )?,
            Item::Struct(item) => {
                emit_type(out, relpath, stack, &item.ident.to_string(), &item.attrs)?
            }
            Item::Enum(item) => {
                emit_type(out, relpath, stack, &item.ident.to_string(), &item.attrs)?
            }
            Item::Union(item) => {
                emit_type(out, relpath, stack, &item.ident.to_string(), &item.attrs)?
            }
            Item::Type(item) => {
                emit_type(out, relpath, stack, &item.ident.to_string(), &item.attrs)?
            }
            Item::Trait(item) => {
                let trait_name = qualified(stack, &item.ident.to_string());
                emit(out, relpath, trait_name.clone(), entry_for(&item.attrs))?;
                for trait_item in &item.items {
                    if let TraitItem::Fn(method) = trait_item {
                        emit(
                            out,
                            relpath,
                            format!("{trait_name}.{}", method.sig.ident),
                            entry_for(&method.attrs),
                        )?;
                    }
                }
            }
            Item::Impl(item) => {
                let Some(owner) = impl_owner(&item.self_ty, stack) else {
                    continue;
                };
                let owner = match &item.trait_ {
                    Some((_, path, _)) => format!("{owner}.{}", dotted_path(path)),
                    None => owner,
                };
                for impl_item in &item.items {
                    if let ImplItem::Fn(method) = impl_item {
                        emit(
                            out,
                            relpath,
                            format!("{owner}.{}", method.sig.ident),
                            entry_for(&method.attrs),
                        )?;
                    }
                }
            }
            Item::Mod(item) => {
                if let Some((_, items)) = &item.content {
                    let mut nested = stack.to_vec();
                    nested.push(item.ident.to_string());
                    visit_items(items, &nested, relpath, out)?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn emit_type(
    out: &mut SpecIndex,
    relpath: &str,
    stack: &[String],
    name: &str,
    attrs: &[Attribute],
) -> Result<(), ExtractError> {
    emit(out, relpath, qualified(stack, name), entry_for(attrs))
}

fn entry_for(attrs: &[Attribute]) -> Option<Entry> {
    let mut lines = Vec::new();
    for attr in attrs {
        if !attr.path().is_ident("doc") {
            continue;
        }
        if let syn::Meta::NameValue(meta) = &attr.meta {
            if let syn::Expr::Lit(expr) = &meta.value {
                if let syn::Lit::Str(text) = &expr.lit {
                    lines.push(text.value());
                }
            }
        }
    }
    let document = parse_markers(&lines.join("\n"));
    if !has_content(&document) {
        return None;
    }
    Some(Entry {
        fqn: None,
        specs: vec![Spec {
            id: document.spec_id,
            spec: document.spec,
            cases: document
                .cases
                .into_iter()
                .map(|case| Case {
                    id: case.id,
                    desc: case.desc,
                    input: case.input,
                    expect: case.expect,
                    forbid: case.forbid,
                })
                .collect(),
            whys: document.whys,
            ideals: document.ideals,
            links: document.links,
            rules: document.rules,
        }],
    })
}

fn has_content(document: &MarkerDocument) -> bool {
    !document.spec.is_empty()
        || !document.cases.is_empty()
        || !document.whys.is_empty()
        || !document.ideals.is_empty()
        || !document.links.is_empty()
        || !document.rules.is_empty()
}

fn emit(
    out: &mut SpecIndex,
    relpath: &str,
    symbol: String,
    entry: Option<Entry>,
) -> Result<(), ExtractError> {
    let Some(entry) = entry else {
        return Ok(());
    };
    merge_entry(out, format!("{relpath}::{symbol}"), entry)
}

fn merge_entry(
    out: &mut SpecIndex,
    symbol_id: String,
    incoming: Entry,
) -> Result<(), ExtractError> {
    for spec in incoming.specs {
        merge_spec(out, symbol_id.clone(), spec)?;
    }
    Ok(())
}

fn merge_spec(out: &mut SpecIndex, symbol_id: String, spec: Spec) -> Result<(), ExtractError> {
    if let Some(spec_id) = &spec.id {
        if !valid_id(spec_id) {
            return Err(ExtractError::InvalidSpecId {
                symbol_id,
                spec_id: spec_id.clone(),
            });
        }
    }
    let Some(existing) = out.get_mut(&symbol_id) else {
        out.insert(
            symbol_id,
            Entry {
                fqn: None,
                specs: vec![spec],
            },
        );
        return Ok(());
    };
    let Some(spec_id) = &spec.id else {
        return Err(ExtractError::AmbiguousSymbol { symbol_id });
    };
    if existing.specs.iter().any(|item| item.id.is_none()) {
        return Err(ExtractError::AmbiguousSymbol { symbol_id });
    }
    if existing
        .specs
        .iter()
        .any(|item| item.id.as_ref() == Some(spec_id))
    {
        return Err(ExtractError::DuplicateSpecId {
            symbol_id,
            spec_id: spec_id.clone(),
        });
    }
    existing.specs.push(spec);
    Ok(())
}

fn qualified(stack: &[String], name: &str) -> String {
    stack
        .iter()
        .map(String::as_str)
        .chain(std::iter::once(name))
        .collect::<Vec<_>>()
        .join(".")
}

fn impl_owner(ty: &Type, stack: &[String]) -> Option<String> {
    let Type::Path(ty) = ty else {
        return None;
    };
    if ty.qself.is_some() || ty.path.segments.is_empty() {
        return None;
    }
    let segments: Vec<String> = ty
        .path
        .segments
        .iter()
        .map(|segment| segment.ident.to_string())
        .collect();
    match segments.first().map(String::as_str) {
        Some("crate") => Some(segments[1..].join(".")),
        Some("self") => Some(
            stack
                .iter()
                .cloned()
                .chain(segments[1..].iter().cloned())
                .collect::<Vec<_>>()
                .join("."),
        ),
        Some("super") => {
            let parent_count = segments
                .iter()
                .take_while(|part| part.as_str() == "super")
                .count();
            if parent_count > stack.len() {
                return None;
            }
            Some(
                stack[..stack.len() - parent_count]
                    .iter()
                    .cloned()
                    .chain(segments[parent_count..].iter().cloned())
                    .collect::<Vec<_>>()
                    .join("."),
            )
        }
        Some(_) if segments.len() == 1 => Some(qualified(stack, &segments[0])),
        Some(_) => Some(segments.join(".")),
        None => None,
    }
}

fn dotted_path(path: &syn::Path) -> String {
    path.segments
        .iter()
        .map(|segment| segment.ident.to_string())
        .collect::<Vec<_>>()
        .join(".")
}

fn source_files(directory: &Path, files: &mut Vec<PathBuf>) -> Result<(), ExtractError> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            if !matches!(entry.file_name().to_str(), Some(".git" | "target")) {
                source_files(&path, files)?;
            }
        } else if path.extension().and_then(|extension| extension.to_str()) == Some("rs") {
            files.push(path);
        }
    }
    Ok(())
}

fn relative_path(path: &Path, root: &Path) -> Option<String> {
    let path = std::path::absolute(path).ok()?;
    let root = std::path::absolute(root).ok()?;
    path.strip_prefix(root)
        .ok()
        .map(|path| path.to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_functions_types_traits_impls_and_modules() {
        let source = r#"
            /// +spec=`top-level contract`
            fn run() {}

            /// +rule=`type-wide rule`
            struct Service;

            impl Service {
                /// +case:id=happy,desc=`works`,expect=`ok`
                fn start(&self) {}
            }

            trait Store {
                /// +why=`stable keys preserve retries`
                fn get(&self);
            }

            impl Store for Service {
                /// +ideal=`one persistence owner`
                fn get(&self) {}
            }

            mod nested {
                /// +spec=`nested contract`
                fn run() {}
            }
        "#;
        let out = extract_file(source, "src/lib.rs").unwrap();
        assert!(out.contains_key("src/lib.rs::run"));
        assert!(out.contains_key("src/lib.rs::Service"));
        assert!(out.contains_key("src/lib.rs::Service.start"));
        assert!(out.contains_key("src/lib.rs::Store.get"));
        assert!(out.contains_key("src/lib.rs::Service.Store.get"));
        assert!(out.contains_key("src/lib.rs::nested.run"));
    }

    #[test]
    fn multiple_declarations_require_unique_named_specs() {
        let unnamed = r#"
            #[cfg(feature = "string")]
            /// +spec=`first`
            fn parse(_: &str) {}
            #[cfg(feature = "number")]
            /// +spec=`second`
            fn parse(_: i32) {}
        "#;
        assert!(matches!(
            extract_file(unnamed, "src/lib.rs"),
            Err(ExtractError::AmbiguousSymbol { .. })
        ));

        let named = r#"
            #[cfg(feature = "string")]
            /// +spec:id=string_input,text=`first`
            fn parse(_: &str) {}
            #[cfg(feature = "number")]
            /// +spec:id=number_input,text=`second`
            fn parse(_: i32) {}
        "#;
        let out = extract_file(named, "src/lib.rs").unwrap();
        assert_eq!(out["src/lib.rs::parse"].specs.len(), 2);
    }

    #[test]
    fn invalid_rust_is_skipped() {
        assert!(extract_file("fn (", "bad.rs").unwrap().is_empty());
    }

    #[test]
    fn block_doc_comments_are_extracted() {
        let out = extract_file(
            "/**\n * +spec=`block doc contract`\n * +rule=`keep the boundary`\n */\nfn run() {}",
            "src/lib.rs",
        )
        .unwrap();
        let spec = &out["src/lib.rs::run"].specs[0];
        assert_eq!(spec.spec, "block doc contract");
        assert_eq!(spec.rules, ["keep the boundary"]);
    }

    #[test]
    fn tree_extraction_preserves_all_named_specs() {
        let root = tempfile::tempdir().unwrap();
        let source_root = root.path().join("src");
        fs::create_dir(&source_root).unwrap();
        fs::write(
            source_root.join("lib.rs"),
            r#"
                #[cfg(feature = "string")]
                /// +spec:id=string_input,text=`first`
                fn parse(_: &str) {}
                #[cfg(feature = "number")]
                /// +spec:id=number_input,text=`second`
                fn parse(_: i32) {}
            "#,
        )
        .unwrap();

        let out = extract_tree(&source_root, root.path()).unwrap();
        assert_eq!(out["src/lib.rs::parse"].specs.len(), 2);
    }
}
