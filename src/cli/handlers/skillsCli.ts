type SkillsCliOptions = {
  force?: boolean
  global?: boolean
  help?: boolean
  json?: boolean
  registry?: string
}

const SKILLS_HELP = `Usage: openclaude skills <command> [options]

Commands:
  list [--json]                    List installed skills
  show <name>                      Show details for an installed skill
  validate <path>                  Validate a local skill directory
  install <idOrUrlOrPath> [options] Install a skill
  remove <name> [--global]         Remove an installed skill`

function parseSkillsCliArgs(args: string[]): {
  options: SkillsCliOptions
  positionals: string[]
  error?: string
} {
  const options: SkillsCliOptions = {}
  const positionals: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--json') {
      options.json = true
    } else if (arg === '--global') {
      options.global = true
    } else if (arg === '--force') {
      options.force = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--registry') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) {
        return { options, positionals, error: '--registry requires a value.' }
      }
      options.registry = value
      index += 1
    } else if (arg?.startsWith('--registry=')) {
      const value = arg.slice('--registry='.length)
      if (!value) {
        return { options, positionals, error: '--registry requires a value.' }
      }
      options.registry = value
    } else if (arg?.startsWith('--')) {
      return { options, positionals, error: `Unknown skills option: ${arg}` }
    } else if (arg) {
      positionals.push(arg)
    }
  }

  return { options, positionals }
}

export async function runSkillsCli(args: string[]): Promise<void> {
  const subcommand = args[1] ?? 'list'
  const { options, positionals, error } = parseSkillsCliArgs(args.slice(2))
  if (error) {
    console.error(error)
    process.exit(1)
  }
  if (subcommand === '--help' || subcommand === '-h' || options.help) {
    console.log(SKILLS_HELP)
    process.exit(0)
  }

  const {
    skillsInstallHandler,
    skillsListHandler,
    skillsRemoveHandler,
    skillsShowHandler,
    skillsValidateHandler,
  } = await import('./skills.js')

  switch (subcommand) {
    case 'list':
      await skillsListHandler({ json: options.json })
      break
    case 'show': {
      const name = positionals[0]
      if (!name) {
        console.error('Skill name is required.')
        process.exit(1)
      }
      await skillsShowHandler(name)
      break
    }
    case 'validate': {
      const path = positionals[0]
      if (!path) {
        console.error('Skill path is required.')
        process.exit(1)
      }
      await skillsValidateHandler(path)
      break
    }
    case 'install': {
      const idOrUrlOrPath = positionals[0]
      if (!idOrUrlOrPath) {
        console.error('Skill ID, URL, or path is required.')
        process.exit(1)
      }
      await skillsInstallHandler(idOrUrlOrPath, options)
      break
    }
    case 'remove': {
      const name = positionals[0]
      if (!name) {
        console.error('Skill name is required.')
        process.exit(1)
      }
      await skillsRemoveHandler(name, { global: options.global })
      break
    }
    default:
      console.error(`Unknown skills command: ${subcommand}`)
      process.exit(1)
  }

  process.exit(process.exitCode ?? 0)
}
