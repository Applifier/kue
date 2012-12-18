REPORTER = spec


test: jshint
	@./node_modules/.bin/mocha \
		--reporter $(REPORTER) \
		--growl \
		-t 8000 \
		--globals encoding \
		--bail \
		test/*.js \
		test/queue/*.js

test-single:
	@./node_modules/.bin/mocha \
		--reporter $(REPORTER) \
		-t 8000 \
		--globals encoding \
		$(TEST)

jshint:
	@./node_modules/.bin/jshint --config jshintrc $(shell find lib -type f \( -name "*.js" ! -path "lib/http/*"  \))

.PHONY: test

