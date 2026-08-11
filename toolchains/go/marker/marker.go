// Package marker owns the Go +spec/+case/+link/+rule authoring grammar.
// Consumers may project the parsed intent into different artifacts: specgen
// emits spec.json for white-box review, while a harness may compile or scaffold
// executable black-box cases. Keeping parsing here prevents those consumers
// from defining subtly different marker dialects.
package marker

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
)

var caseIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

// Case is one natural-language case marker. Group is optional authoring
// metadata used by harnesses to organize generated artifacts; it is not part of
// the canonical spec.json review projection.
type Case struct {
	ID     string
	Desc   string
	Input  string
	Expect string
	Forbid string
	Group  string
}

// Document is the marker intent attached to one Go symbol.
type Document struct {
	SpecID string
	Spec   string
	Cases  []Case
	Links  []string
	Rules  []string
}

// Parse reads canonical marker lines from a Go doc comment. It accepts text
// both with and without leading // so callers can pass ast.CommentGroup.Text()
// or raw comment lines.
func Parse(doc string) Document {
	var out Document
	for _, raw := range strings.Split(doc, "\n") {
		line := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), "//"))
		switch {
		case strings.HasPrefix(line, "+spec:"):
			args := parseArgs(strings.TrimPrefix(line, "+spec:"))
			if id := args["id"]; id == "" || caseIDPattern.MatchString(id) {
				out.SpecID = id
				out.Spec = args["text"]
			}
		case strings.HasPrefix(line, "+spec="):
			out.Spec = unquote(strings.TrimPrefix(line, "+spec="))
		case strings.HasPrefix(line, "+case:"):
			args := parseArgs(strings.TrimPrefix(line, "+case:"))
			if !caseIDPattern.MatchString(args["id"]) {
				continue
			}
			out.Cases = append(out.Cases, Case{
				ID: args["id"], Desc: args["desc"],
				Input: args["input"], Expect: args["expect"], Forbid: args["forbid"],
				Group: args["group"],
			})
		case strings.HasPrefix(line, "+link="):
			if value := unquote(strings.TrimPrefix(line, "+link=")); value != "" {
				out.Links = append(out.Links, value)
			}
		case strings.HasPrefix(line, "+rule="):
			if value := unquote(strings.TrimPrefix(line, "+rule=")); value != "" {
				out.Rules = append(out.Rules, value)
			}
		}
	}
	return out
}

// IntentHash fingerprints the executable intent of one marker case plus its
// enclosing spec. Group is deliberately excluded: moving a generated case to
// another organizational bucket does not change what the case asserts.
func IntentHash(c Case, spec string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		c.ID, c.Desc, c.Input, c.Expect, c.Forbid, spec,
	}, "\x00")))
	return hex.EncodeToString(sum[:])[:8]
}

func parseArgs(s string) map[string]string {
	args := map[string]string{}
	for i, n := 0, len(s); i < n; {
		for i < n && (s[i] == ',' || s[i] == ' ') {
			i++
		}
		keyStart := i
		for i < n && s[i] != '=' {
			i++
		}
		if i >= n {
			break
		}
		key := strings.TrimSpace(s[keyStart:i])
		i++
		var value string
		if i < n && (s[i] == '`' || s[i] == '"') {
			quote := s[i]
			i++
			start := i
			for i < n && s[i] != quote {
				i++
			}
			value = s[start:i]
			if i < n {
				i++
			}
		} else {
			start := i
			for i < n && s[i] != ',' {
				i++
			}
			value = strings.TrimSpace(s[start:i])
		}
		if key != "" {
			args[key] = value
		}
	}
	return args
}

func unquote(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 && (s[0] == '`' || s[0] == '"') && s[len(s)-1] == s[0] {
		return s[1 : len(s)-1]
	}
	return s
}
