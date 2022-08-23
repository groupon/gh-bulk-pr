/*
 * Copyright (c) 2022, Groupon, Inc.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software
 *    without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
import { readFileSync } from 'fs';
import { homedir } from 'os';

import { program } from 'commander';

import bulkPrCmd, { PackageJson } from './bulk-pr-cmd';

const pjson = JSON.parse(
  readFileSync(require.resolve('../package.json'), 'utf8')
) as PackageJson;

const DEF_BASE_DIR = `${homedir()}/.local/share/gh-bulk-pr`;
program
  .name('gh bulk-pr')
  .arguments('<repo...>')
  .version(pjson.version)
  .description('clone, edit, and open PRs against multiple repos')
  .requiredOption(
    '-c, --cmd-line <sh>',
    'Run given commands in a shell in the checked out repo (required)'
  )
  .option('-j, --json', 'Return output as JSON rows')
  .option(
    '-a, --after-commit-cmd-line <sh>',
    'Run given commands after the -c results are committed (e.g. for post-commit tests)'
  )
  .option(
    '-C, --no-commit',
    'Assume that the commands executed will perform the commits themselves - requires --title'
  )
  .option(
    '-t, --title <t>',
    'Specify a title for the created PR (by default based on first line of the commit msg)'
  )
  .option(
    '-b, --branch <b>',
    'Specify branch name to create for PR (defaults to normalized title)'
  )
  .option('-m, --commit-msg <msg>', 'Use the given single-line commit msg')
  .option(
    '-f, --commit-msg-file <path>',
    'Use the (multi-line) commit msg from the given file'
  )
  .option(
    '-p, --pr-msg-file <path>',
    'Use the PR msg from the given file; defaults to remaining lines from commit msg'
  )
  .option(
    '-d, --clone-base-dir <dir>',
    'Directory to do clones for PRs into',
    DEF_BASE_DIR
  )
  .option('--no-clone', 'Use existing clone dir & branch')
  .option('-n, --dry-run', "Don't actually create branches or open the PR")
  .action(bulkPrCmd.bind(null, pjson));

program.parseAsync(process.argv).catch((err: any) => {
  process.nextTick(() => {
    throw err;
  });
});
