# GitHub CLI "bulk-pr" Extension

## Requirements

* [GitHub CLI](https://cli.github.com/)
* [NodeJS](https://nodejs.org/) >= 14.x

## Installation

```
$ gh extension install https://github.com/groupon/gh-bulk-pr
```

The first time you run `gh bulk-pr` additional dependencies will be
automatically installed.

## Usage

```
$ gh bulk-pr --help
Usage: gh bulk-pr [options] <repo...>

clone, edit, and open PRs against multiple repos

Options:
  -V, --version                     output the version number
  -c, --cmd-line <sh>               Run given commands in a shell in the checked out repo (required)
  -j, --json                        Return output as JSON rows
  -a, --after-commit-cmd-line <sh>  Run given commands after the -c results are committed (e.g. for
                                    post-commit tests)
  -C, --no-commit                   Assume that the commands executed will perform the commits themselves -
                                    requires --title
  -t, --title <t>                   Specify a title for the created PR (by default based on first line of the
                                    commit msg)
  -b, --branch <b>                  Specify branch name to create for PR (defaults to normalized title)
  -m, --commit-msg <msg>            Use the given single-line commit msg
  -f, --commit-msg-file <path>      Use the (multi-line) commit msg from the given file
  -p, --pr-msg-file <path>          Use the PR msg from the given file; defaults to remaining lines from
                                    commit msg
  -d, --clone-base-dir <dir>        Directory to do clones for PRs into (default:
                                    "/Users/dbushong/.local/share/gh-bulk-pr")
  --no-clone                        Use existing clone dir & branch
  -n, --dry-run                     Don't actually create branches or open the PR
  -h, --help                        display help for command
```

This command allows you to create Bulk PRs, with repeatable commands, across
a given list of repositories.

## Examples

Add a simple line to the README.md:

```
$ gh bulk-pr \
  --cmd-line='echo Kilroy was here >> README.md' \
  --commit-msg='docs: enhance the README' \
  myorg/myrepo1 \
  myorg/myrepo2
myorg/myrepo1: ran successfully in /Users/someuser/.local/share/gh-bulk-pr/myorg/myrepo1
myorg/myrepo1: changes:
  M README.md
myorg/myrepo1: opened PR: https://github.com/myorg/myrepo1/pull/650
myorg/myrepo2: ran successfully in /Users/someuser/.local/share/gh-bulk-pr/myorg/myrepo2
myorg/myrepo2: changes:
  M README.md
myorg/myrepo2: opened PR: https://github.com/myorg/myrepo2/pull/47
```
