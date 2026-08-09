PYTHON_PROJECT := toolchains/python
GO_PROJECT := toolchains/go
TYPESCRIPT_PROJECT := toolchains/typescript

.PHONY: test test-python test-go test-typescript

test: test-python test-go test-typescript

test-python:
	$(MAKE) -C $(PYTHON_PROJECT) test

test-go:
	go -C $(GO_PROJECT) test ./...

test-typescript:
	npm --prefix $(TYPESCRIPT_PROJECT) test
