.PHONY: install build typecheck test test-verbose coverage validate validate-links \
        docker-build docker-test parity gen-tables clean

install:
	npm ci

build:
	npm run build

typecheck:
	npm run typecheck

test:
	npm run test

test-verbose:
	npm run test:verbose

coverage:
	npm run test:coverage

# The two checks .github/workflows/quality.yml runs, in order.
validate:
	npx tsx scripts/validate_readme.ts README.md

validate-links:
	npx tsx scripts/validate_readme.ts README.md --check-links

docker-build:
	docker build -t awesome-ai-ts:0.1.0 .

# Runs the migrated suite inside the image, the way the Python image ran unittest.
docker-test:
	docker build --target test -t awesome-ai-ts:test .
	docker run --rm awesome-ai-ts:test

# Differential equivalence probe: tools/cases.json through both implementations.
# An empty diff is the evidence that the port preserves behaviour rather than
# merely resembling it.
#
# The reference half, tools/reference_probe.py, lives in the SOURCE repository
# and so is already inside the image -- it imports scripts/validate_readme.py
# and can only run there. Only the shared case list is mounted in, and it is
# mounted read-only over the image's own tools/ directory.
#
# Requires the Python reference image built from the original repo:
#   docker build -f ../../docker/awesome-ai-python-test.Dockerfile \
#     -t awesome-ai-python-test ../../scraped_repos/Python/owainlewis_awesome-artificial-intelligence
parity:
	docker run --rm -v "$(CURDIR)/tools/cases.json:/app/tools/cases.json:ro" \
		awesome-ai-python-test python /app/tools/reference_probe.py > /tmp/probe-py.txt
	npx tsx tools/equivalence_probe.ts > /tmp/probe-ts.txt
	diff /tmp/probe-py.txt /tmp/probe-ts.txt && echo "EQUIVALENT: no behavioural differences"

# Regenerates scripts/internal/casedata.ts from a CPython dump. See the header
# of tools/gen_case_tables.mjs for the dump command.
gen-tables:
	node tools/gen_case_tables.mjs py_case.json nonprintable.json scripts/internal/casedata.ts

clean:
	rm -rf node_modules dist coverage
