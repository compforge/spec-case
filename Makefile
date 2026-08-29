PYTHON_PROJECT := toolchains/python
GO_PROJECT := toolchains/go
TYPESCRIPT_PROJECT := toolchains/typescript
RUST_PROJECT := toolchains/rust

.PHONY: test test-python test-go test-typescript test-rust

test: test-python test-go test-typescript test-rust

test-python:
	$(MAKE) -C $(PYTHON_PROJECT) test

test-go:
	go -C $(GO_PROJECT) test ./...

test-typescript:
	npm --prefix $(TYPESCRIPT_PROJECT) test

test-rust:
	cargo test --manifest-path $(RUST_PROJECT)/Cargo.toml
