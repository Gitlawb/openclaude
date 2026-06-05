import assert from 'node:assert/strict'
import test from 'node:test'

import { Command } from '@commander-js/extra-typings'

import { registerMcpDoctorCommand } from './doctorCommand.js'

test('registerMcpDoctorCommand adds the doctor subcommand with expected options', () => {
  const mcp = new Command('mcp')

  registerMcpDoctorCommand(mcp)

  const doctor = mcp.commands.find(command => command.name() === 'doctor')
  assert.ok(doctor)
  assert.equal(doctor?.usage(), '[options] [name]')

  const optionFlags = doctor?.options.map(option => option.long)
  assert.deepEqual(optionFlags, ['--scope', '--config-only', '--json'])
})
