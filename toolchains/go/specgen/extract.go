// Command specgen statically extracts the +spec/+case/+link/+rule doc-comment
// markers from Go sources into spec.json — the artifact ccr's SpecBuilder
// consumes. Discovery is pure go/ast analysis: the scanned code is never
// imported or run, so the markers cost nothing at build time and work even when
// the code does not compile.
//
// The marker grammar follows kubebuilder's convention — a "+" prefix and a
// single-line "name:key=value" form, which sidesteps gofmt's reflow of
// multi-line doc comments — and is shared through the marker package.
package specgen

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/compforge/spec-case/toolchains/go/marker"
)

// Case mirrors one spec.json case entry.
type Case struct {
	ID     string `json:"id"`
	Desc   string `json:"desc,omitempty"`
	Input  string `json:"input,omitempty"`
	Expect string `json:"expect,omitempty"`
	Forbid string `json:"forbid,omitempty"`
}

// Entry is one symbol's spec.json entry (keyed by its symbol-id).
type Entry struct {
	Fqn   string   `json:"fqn,omitempty"` // importpath.Symbol — location-independent id for cross-repo refs
	Spec  string   `json:"spec,omitempty"`
	Cases []Case   `json:"cases"` // required by the schema; may be empty
	Links []string `json:"links,omitempty"`
	Rules []string `json:"rules,omitempty"`
}

// parseMarkers scans a doc comment (of a function or a type) for the markers and
// builds its entry, or returns ok=false when it carries none. Each marker is one line.
func parseMarkers(doc *ast.CommentGroup) (Entry, bool) {
	lines := make([]string, 0, len(doc.List))
	for _, c := range doc.List {
		lines = append(lines, c.Text)
	}
	parsed := marker.Parse(strings.Join(lines, "\n"))
	e := Entry{
		Spec:  parsed.Spec,
		Cases: make([]Case, 0, len(parsed.Cases)),
		Links: parsed.Links,
		Rules: parsed.Rules,
	}
	for _, c := range parsed.Cases {
		e.Cases = append(e.Cases, Case{
			ID: c.ID, Desc: c.Desc, Input: c.Input, Expect: c.Expect, Forbid: c.Forbid,
		})
	}
	return e, e.Spec != "" || len(e.Cases) > 0 || len(e.Links) > 0 || len(e.Rules) > 0
}

// symbolOf returns a function's symbol: "Name" for a free function, "Recv.Method"
// for a method (receiver normalized — pointer and generic params stripped), so
// the symbol-id matches the contract and ccr's Go splitter.
func symbolOf(fd *ast.FuncDecl) string {
	if recv := recvTypeName(fd); recv != "" {
		return recv + "." + fd.Name.Name
	}
	return fd.Name.Name
}

func recvTypeName(fd *ast.FuncDecl) string {
	if fd.Recv == nil || len(fd.Recv.List) == 0 {
		return ""
	}
	expr := fd.Recv.List[0].Type
	if star, ok := expr.(*ast.StarExpr); ok { // *T
		expr = star.X
	}
	switch e := expr.(type) {
	case *ast.IndexExpr: // T[P]
		expr = e.X
	case *ast.IndexListExpr: // T[P, Q]
		expr = e.X
	}
	if id, ok := expr.(*ast.Ident); ok {
		return id.Name
	}
	return ""
}

// ExtractFile parses Go source and returns spec.json entries keyed by symbol-id
// (<relpath>::<symbol>). Returns nil on a parse error — specgen never fails the
// build.
func ExtractFile(src, relpath string) map[string]Entry {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, relpath, src, parser.ParseComments|parser.SkipObjectResolution)
	if err != nil {
		return nil
	}
	out := map[string]Entry{}
	for _, decl := range f.Decls {
		switch d := decl.(type) {
		case *ast.FuncDecl:
			if d.Doc == nil {
				continue
			}
			if e, ok := parseMarkers(d.Doc); ok {
				out[relpath+"::"+symbolOf(d)] = e
			}
		case *ast.GenDecl:
			// Type declarations: markers on a type (e.g. +rule for a type-wide usage
			// constraint) bind to <relpath>::TypeName. A single `type X ...` puts the
			// doc on the GenDecl; a grouped `type ( ... )` puts it on each TypeSpec.
			if d.Tok != token.TYPE {
				continue
			}
			for _, spec := range d.Specs {
				ts, ok := spec.(*ast.TypeSpec)
				if !ok {
					continue
				}
				doc := ts.Doc
				if doc == nil && len(d.Specs) == 1 {
					doc = d.Doc
				}
				if doc == nil {
					continue
				}
				if e, ok := parseMarkers(doc); ok {
					out[relpath+"::"+ts.Name.Name] = e
				}
			}
		}
	}
	return out
}

// ExtractTree extracts spec.json from every .go under srcDir; symbol-id paths are
// relative to root (the repo root, so keys match ccr's review address space). Each
// entry's fqn (importpath.Symbol) is resolved from the file's package via go.mod.
func ExtractTree(srcDir, root string) (map[string]Entry, error) {
	out := map[string]Entry{}
	memo := map[string]goMod{} // go.mod lookups, memoized per start dir
	err := filepath.WalkDir(srcDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") {
			return err
		}
		src, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil // skip unreadable
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return nil
		}
		pkg := pkgImportPath(path, memo) // "" when no resolvable go.mod
		for k, v := range ExtractFile(string(src), filepath.ToSlash(rel)) {
			if pkg != "" {
				if i := strings.Index(k, "::"); i >= 0 {
					v.Fqn = pkg + "." + k[i+2:] // symbol = the key's ::suffix
				}
			}
			out[k] = v
		}
		return nil
	})
	return out, err
}

// goMod is a resolved go.mod: its directory + module path ("" when none found).
type goMod struct {
	root string
	path string
}

// findGoMod walks up from startDir to the nearest go.mod, memoized per startDir.
func findGoMod(startDir string, memo map[string]goMod) goMod {
	if m, ok := memo[startDir]; ok {
		return m
	}
	for d := startDir; ; {
		if data, err := os.ReadFile(filepath.Join(d, "go.mod")); err == nil {
			m := goMod{root: d, path: parseModulePath(data)}
			memo[startDir] = m
			return m
		}
		parent := filepath.Dir(d)
		if parent == d {
			break
		}
		d = parent
	}
	memo[startDir] = goMod{}
	return goMod{}
}

// parseModulePath returns the module path from a go.mod's `module` directive.
func parseModulePath(b []byte) string {
	for _, line := range strings.Split(string(b), "\n") {
		if line = strings.TrimSpace(line); strings.HasPrefix(line, "module ") {
			path := strings.TrimSpace(line[len("module "):])
			// strip a trailing `// comment` — left in, it corrupts every fqn
			// derived from the module path
			if i := strings.Index(path, "//"); i >= 0 {
				path = strings.TrimSpace(path[:i])
			}
			return path
		}
	}
	return ""
}

// pkgImportPath returns the Go import path of the package containing filerel
// (module path + dir relative to go.mod), or "" when no go.mod resolves.
func pkgImportPath(filerel string, memo map[string]goMod) string {
	abs, err := filepath.Abs(filerel)
	if err != nil {
		return ""
	}
	dir := filepath.Dir(abs)
	gm := findGoMod(dir, memo)
	if gm.path == "" {
		return ""
	}
	rel, err := filepath.Rel(gm.root, dir)
	if err != nil {
		return ""
	}
	if rel = filepath.ToSlash(rel); rel != "." {
		return gm.path + "/" + rel
	}
	return gm.path
}
