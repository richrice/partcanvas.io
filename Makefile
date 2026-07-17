RAILWAY_SERVICE ?= web
RAILWAY_ENVIRONMENT ?= production
RAILWAY_MESSAGE ?= make deploy

.PHONY: help deploy test

help:
	@printf '%s\n' \
		'make deploy  Deploy the current working tree to Railway' \
		'make test    Run the unit test suite once' \
		'' \
		'Overrides:' \
		'  RAILWAY_SERVICE=$(RAILWAY_SERVICE)' \
		'  RAILWAY_ENVIRONMENT=$(RAILWAY_ENVIRONMENT)' \
		'  RAILWAY_MESSAGE=$(RAILWAY_MESSAGE)'

deploy:
	@command -v railway >/dev/null 2>&1 || { \
		echo 'Railway CLI is required: https://docs.railway.com/guides/cli'; \
		exit 1; \
	}
	railway up \
		--service "$(RAILWAY_SERVICE)" \
		--environment "$(RAILWAY_ENVIRONMENT)" \
		--message "$(RAILWAY_MESSAGE)"

test:
	npm test
