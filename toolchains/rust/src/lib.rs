//! Rust marker grammar and static `spec.json` extraction.

mod marker;
mod specgen;

pub use marker::{parse_markers, MarkerCase, MarkerDocument, MarkerTmp};
pub use specgen::{extract_file, extract_tree, Case, Entry, ExtractError, Spec, SpecIndex, Tmp};
