#!/usr/bin/env node

c = require('ansi-colors')
fs = require('fs')
glob = require('glob')
const path = require('node:path')
const { parseArgs } = require('node:util');
yaml = require('yaml')

let args = []
const options = {
	'help': {
		type: 'boolean',
		short: 'h',
		default: false,
		description: "Display this help"
	},
	'revbump': {
		type: 'boolean',
		short: 'r',
		default: false,
		description: "Bump all package revisions"
	},
	'format': {
		type: 'boolean',
		short: 'f',
		default: false,
		description: "Format all YAML"
	},
	'by-file': {
		type: 'boolean',
		short: 'F',
		default: false,
		description: "Split statistics by file"
	},
	'maintainers': {
		type: 'boolean',
		short: 'm',
		default: false,
		description: "List how many packages each maintainer maintains"
	},
	'missing-maintainers': {
		type: 'boolean',
		short: 'M',
		default: false,
		description: "List packages that don't have a maintainer"
	},
	'lint': {
		type: 'boolean',
		short: 'l',
		default: false,
		description: "Lint the bootstrap files"
	}
}

try {
	args = parseArgs({
		options,
		allowPositionals: true
	})
} catch(e) {
	if(e instanceof TypeError) {
		console.error(e.message)
	} else {
		throw e;
	}
	process.exit(1)
}

var maintainers_summary = {}
var missing_maintainers_summary = []
var total_pkgs = 0

let has_options = false

Object.keys(args.values).forEach(function(k, i) {
	has_options |= args.values[k]
})

if(args.values.help || !has_options) {
	console.log("Usage: node xmu.js [OPTION] [PATH]")

	const max_len = Math.max(...(Object.keys(options).map(el => el.length))) + 7;

	for([n, params] of Object.entries(options)) {
		str = `\t--${n}`
		if(params.short) {
			str += `, -${params.short}`
		}
		if(params.description) {
			str += `:${' '.repeat((max_len - str.length))} ${params.description}.`
		}
		console.log(str)
	}

	process.exit(0)
}

if(args.positionals.length && !fs.existsSync(args.positionals[0])) {
	console.log(c.red("error") + `: path '${args.positionals[0]}' does not exist`)
	process.exit(1)
}

if(!args.positionals.length || fs.lstatSync(args.positionals[0]).isDirectory()) {
	root = (args.positionals.length) ? args.positionals[0] : '.'
	handle_file(path.join(root, 'bootstrap.yml'))

	categories = glob.sync(path.join(root, "bootstrap.d", "*.yml"))
	for(f of categories) {
		handle_file(f)
	}
} else {
	handle_file(args.positionals[0])
}

if(args.values.maintainers && !args.values["by-file"]) {
	const pkg_count = Object.values(maintainers_summary).reduce((sum, count) => sum + count, 0)
	console.log(c.bold(`${Object.keys(maintainers_summary).length} maintainers own ${pkg_count} of ${total_pkgs} total packages:`))
	for([m, n] of Object.entries(maintainers_summary)) {
		console.log(c.yellow(`  ${m}`) + `: ${n} package(s)`)
	}
}

if(args.values['missing-maintainers'] && !args.values["by-file"]) {
	console.log(c.bold(c.yellow(`${missing_maintainers_summary.length} packages`) + ` of ${total_pkgs} have no maintainer:`))

	for(m of missing_maintainers_summary) {
		console.log(`  ${m}`)
	}
}

function handle_file(path) {
	const file = fs.readFileSync(path, 'utf8')
	doc = yaml.parseDocument(file)

	if(args.values.revbump) {
		pkgs = doc.contents.get('packages')

		for (pkg of pkgs.items) {
			if (!pkg.has('revision')) {
				pkg.set('revision', 2)
			} else {
				rev = pkg.get('revision', /* keepScalar = */ true)
				rev.value += 1
			}
		}
	}

	if(args.values.revbump || args.values.format) {
		process.stdout.write(
			doc.toString({
				flowCollectionPadding: false,
				lineWidth: 0,
				indentSeq: true,
			})
		)
	}

	if(args.values.maintainers) {
		pkgs = doc.contents.get('packages')
		maintainers = {}

		for (pkg of pkgs.items) {
			if(pkg.has('metadata') && pkg.get('metadata').has('maintainer')) {
				if(args.values["by-file"]) {
					const prev = maintainers[pkg.get('metadata').get('maintainer')]
					maintainers[pkg.get('metadata').get('maintainer')] = prev ? prev + 1 : 1
				} else {
					const prev = maintainers_summary[pkg.get('metadata').get('maintainer')]
					maintainers_summary[pkg.get('metadata').get('maintainer')] = prev ? prev + 1 : 1
				}
			}
		}

		if(args.values["by-file"]) {
			const pkg_count = Object.values(maintainers).reduce((sum, count) => sum + count, 0)
			console.log(c.bold(`${Object.keys(maintainers).length} maintainers own ${pkg_count} of ${Object.keys(pkgs['items']).length} total packages in '${path}':`))
			for([m, n] of Object.entries(maintainers)) {
				console.log(c.yellow(`  ${m}`) + `: ${n} package(s)`)
			}
		}
	}

	if(args.values['missing-maintainers']) {
		pkgs = doc.contents.get('packages')
		missing = []

		for (pkg of pkgs.items) {
			if(!pkg.has('metadata') || !pkg.get('metadata').has('maintainer')) {
				missing.push(pkg.get('name'))
			}
		}

		if(args.values["by-file"]) {
			console.log(c.bold(c.yellow(`${missing.length} packages`) + ` in '${path}' have no maintainer:`))

			for(m of missing) {
				console.log(`  ${m}`)
			}
		} else {
			missing_maintainers_summary = missing_maintainers_summary.concat(missing)
		}

		total_pkgs += Object.keys(pkgs.items).length
	}

	if(args.values.lint) {
		pkgs = doc.contents.get('packages')

		f = Object.entries(pkgs).filter((p) => {
			return p[0] == "items"
		}).map((m) => {
			return m[1];
		}).flat(1);

		for(i of f) {
			if(i.has('configure')) {
				configure_steps = i.getIn(['configure']);

				for(num = 0; configure_steps.has(num); num++) {
					arg_list = configure_steps.getIn([num, 'args']);
					if(arg_list instanceof yaml.YAMLSeq && arg_list.has(1) && arg_list.get(0) == 'meson' && arg_list.get(1) != 'setup') {
						console.log(c.yellow(i.get('name')) + ": meson is invoked without `setup`");
					}
				}
			}
		}
	}
}