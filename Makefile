PYTHON_PROJECT := toolchains/python
GO_PROJECT := toolchains/go

.PHONY: test test-python test-go

test: test-python test-go

test-python:
	$(MAKE) -C $(PYTHON_PROJECT) test

test-go:
	go -C $(GO_PROJECT) test ./...
