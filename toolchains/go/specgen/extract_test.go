package specgen

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"testing"
)

type conformanceFixture struct {
	Cases []struct {
		Name   string `json:"name"`
		Source struct {
			Go string `json:"go"`
		} `json:"source"`
		Symbol struct {
			Go string `json:"go"`
		} `json:"symbol"`
		Expected *Entry `json:"expected_entry"`
	} `json:"cases"`
}

func TestSharedConformance(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve conformance fixture: current test file is unknown")
	}
	path := filepath.Join(filepath.Dir(currentFile), "..", "..", "..", "conformance", "specgen", "cases.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read conformance fixture %s: %v", path, err)
	}
	var fixture conformanceFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("parse conformance fixture %s: %v", path, err)
	}

	for _, tc := range fixture.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			entry, found := ExtractFile(tc.Source.Go, "fixture.go")[tc.Symbol.Go]
			if tc.Expected == nil {
				if found {
					t.Fatalf("unexpected entry: %+v", entry)
				}
				return
			}
			if !found {
				t.Fatal("expected entry is missing")
			}
			if !reflect.DeepEqual(entry, *tc.Expected) {
				t.Fatalf("entry mismatch:\n got: %+v\nwant: %+v", entry, *tc.Expected)
			}
		})
	}
}

func TestExtractMarkers(t *testing.T) {
	src := "package p\n\n" +
		"// CreateNotebook creates a notebook.\n" +
		"//\n" +
		"// +spec=`(tenant,name) unique; dup -> ConflictError`\n" +
		"// +case:id=happy,desc=`name only`,expect=`201; id non-empty`\n" +
		"// +case:id=dup,desc=`duplicate name`,expect=`409`,forbid=`a second row is written`\n" +
		"// +link=docs/tenancy.md\n" +
		"// +rule=`hot path: watch new sync DB calls`\n" +
		"func (s *Service) CreateNotebook(req Req) error { return nil }\n\n" +
		"// Unmarked has no markers.\n" +
		"func Unmarked() {}\n"

	out := ExtractFile(src, "app/api.go")

	e, ok := out["app/api.go::Service.CreateNotebook"] // method binds to Recv.Method
	if !ok {
		t.Fatalf("missing CreateNotebook; got %v", sortedKeys(out))
	}
	s := e.Specs[0]
	if !strings.Contains(s.Spec, "ConflictError") {
		t.Errorf("spec: %q", s.Spec)
	}
	if len(s.Cases) != 2 || s.Cases[0].ID != "happy" || s.Cases[1].ID != "dup" {
		t.Fatalf("cases: %+v", s.Cases)
	}
	if s.Cases[0].Expect != "201; id non-empty" { // semicolon inside backticks survives
		t.Errorf("expect: %q", s.Cases[0].Expect)
	}
	if s.Cases[1].Forbid != "a second row is written" {
		t.Errorf("forbid: %q", s.Cases[1].Forbid)
	}
	if len(s.Links) != 1 || s.Links[0] != "docs/tenancy.md" {
		t.Errorf("links: %v", s.Links)
	}
	if len(s.Rules) != 1 {
		t.Errorf("rules: %v", s.Rules)
	}
	if _, ok := out["app/api.go::Unmarked"]; ok {
		t.Error("unmarked func should be absent")
	}
}

func TestExtractTypeLevelMarkers(t *testing.T) {
	// +rule on a type declaration → a type-wide usage constraint, keyed by
	// <relpath>::TypeName. Covers both single and grouped type decls.
	src := "package p\n\n" +
		"// PhaseEventMiddleware accumulates events.\n" +
		"// +spec=`accumulates per-run events; instances hold state`\n" +
		"// +case:id=reuse_leaks,desc=`reused across requests`,forbid=`events retained across requests`\n" +
		"// +link=docs/middleware.md\n" +
		"// +rule=`per-request only — do not cache/reuse (accumulates unbounded state)`\n" +
		"type PhaseEventMiddleware struct{ events []int }\n\n" +
		"type (\n" +
		"\t// +rule=`grouped decl rule`\n" +
		"\tGrouped struct{ x int }\n" +
		")\n\n" +
		"// Plain has no markers.\n" +
		"type Plain struct{}\n"

	out := ExtractFile(src, "mw/trace.go")

	e, ok := out["mw/trace.go::PhaseEventMiddleware"]
	if !ok {
		t.Fatalf("missing PhaseEventMiddleware; got %v", sortedKeys(out))
	}
	// all four markers bind to the type symbol-id
	s := e.Specs[0]
	if !strings.Contains(s.Spec, "per-run events") {
		t.Errorf("spec: %q", s.Spec)
	}
	if len(s.Cases) != 1 || s.Cases[0].ID != "reuse_leaks" {
		t.Errorf("cases: %+v", s.Cases)
	}
	if len(s.Links) != 1 || s.Links[0] != "docs/middleware.md" {
		t.Errorf("links: %v", s.Links)
	}
	if len(s.Rules) != 1 || !strings.Contains(s.Rules[0], "per-request only") {
		t.Errorf("rules: %v", s.Rules)
	}
	if _, ok := out["mw/trace.go::Grouped"]; !ok {
		t.Errorf("grouped type decl marker missing; got %v", sortedKeys(out))
	}
	if _, ok := out["mw/trace.go::Plain"]; ok {
		t.Error("unmarked type should be absent")
	}
}

func TestExtractTree_FqnFromGoMod(t *testing.T) {
	// fqn = <module path>/<dir>.<Symbol>, resolved from the file's go.mod.
	dir := t.TempDir()
	write := func(rel, content string) {
		full := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("go.mod", "module github.com/org/framework\n\ngo 1.21\n")
	write("common/middleware/trace/trace.go",
		"package trace\n\n// +rule=`per-request only — do not cache/reuse`\ntype PhaseEventMiddleware struct{ events []int }\n")

	out, err := ExtractTree(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	e, ok := out["common/middleware/trace/trace.go::PhaseEventMiddleware"]
	if !ok {
		t.Fatalf("missing entry; got %v", sortedKeys(out))
	}
	if want := "github.com/org/framework/common/middleware/trace.PhaseEventMiddleware"; e.Fqn != want {
		t.Errorf("fqn = %q, want %q", e.Fqn, want)
	}
}

func TestParseModulePath_StripsTrailingComment(t *testing.T) {
	got := parseModulePath([]byte("module example.com/mylib // indirection\n\ngo 1.21\n"))
	if want := "example.com/mylib"; got != want {
		t.Errorf("module path = %q, want %q", got, want)
	}
}

func TestMalformedCaseIDSkipped(t *testing.T) {
	out := ExtractFile("package p\n\n// +case:id=Bad-ID,desc=`x`\nfunc f() {}\n", "f.go")
	if _, ok := out["f.go::f"]; ok {
		t.Error("a function whose only case has a malformed id should be absent")
	}
}

func TestSpecOnlyHasEmptyCases(t *testing.T) {
	out := ExtractFile("package p\n\n// +spec=`x`\nfunc f() {}\n", "f.go")
	e := out["f.go::f"]
	if len(e.Specs) != 1 || e.Specs[0].Spec != "x" || e.Specs[0].Cases == nil || len(e.Specs[0].Cases) != 0 {
		t.Errorf("spec-only entry must have empty non-nil cases: %+v", e)
	}
}

func TestUnparseableIsNil(t *testing.T) {
	if ExtractFile("func (:", "bad.go") != nil {
		t.Error("unparseable source should extract to nil")
	}
}

func sortedKeys(m map[string]Entry) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}
