"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const child_process_1 = require("child_process");
const promises_1 = require("fs/promises");
const util_1 = require("util");
const rest_1 = require("@octokit/rest");
const plugin_request_log_1 = require("@octokit/plugin-request-log");
const chalk_1 = __importDefault(require("chalk"));
const debug_1 = __importDefault(require("debug"));
const rimraf_1 = __importDefault(require("rimraf"));
const simple_git_1 = require("simple-git");
const gh_auth_status_1 = __importDefault(require("./gh-auth-status"));
const logger_1 = __importDefault(require("./logger"));
const { bold, underline, red, green } = chalk_1.default;
const debug = (0, debug_1.default)('gh-bulk-pr');
const rimraf = (0, util_1.promisify)(rimraf_1.default);
const delay = (0, util_1.promisify)(setTimeout);
const exec = (0, util_1.promisify)(child_process_1.exec);
function tokenize(str) {
    return str
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-{2,}/g, '-')
        .toLowerCase();
}
// TODO: PR this to simple-git as .config()
function gitConfig(git) {
    return git
        .raw(['config', '--list', '--null'])
        .then(rawCfg => new Map(rawCfg.split('\0').map(pair => pair.split('\n'))));
}
async function originBranch(git) {
    for (const [key, val] of await gitConfig(git)) {
        const m = key.match(/^branch\.(.+)\.remote$/);
        if (m && val === 'origin')
            return m[1];
    }
    throw new Error("Couldn't find branch.*.remote=origin in git config");
}
async function verifyOnBranch(git, branch, dir) {
    const { current } = await git.branchLocal();
    if (branch !== current) {
        throw new Error(`Expected ${dir} to be on branch ${branch} for --no-clone`);
    }
}
async function createForkIfNeeded(gh, git, login, owner, repo, repoUrl, log, clone) {
    if (owner === login)
        return repoUrl;
    // try to create fork (if already exists, will also return 200)
    log.tmp(`ensuring fork of ${owner}/${repo}`, {
        op: 'fork',
        ownerRepo: `${owner}/${repo}`,
        login,
    });
    const { data: fork } = await gh.repos.createFork({ owner, repo });
    const forkUrl = fork.ssh_url;
    log.tmp(`using ${forkUrl}`, {
        op: 'forkResult',
        ownerRepo: `${owner}/${repo}`,
        forkUrl,
    });
    if (!clone)
        return forkUrl;
    // if was created a while ago, we don't need to wait for it to exist
    if (Date.now() - new Date(fork.created_at).valueOf() < 30e3) {
        // ...else wait 5s for it to exist
        await delay(5000);
    }
    await git.addRemote('fork', forkUrl);
    await git.fetch(['fork']);
    return forkUrl;
}
const FILE_PROPS = [
    'created',
    'deleted',
    'modified',
    'renamed',
    'not_added',
];
async function runCommands(dir, git, cmdLine, log, ownerRepo, checkChanged) {
    log.tmp(`running: ${cmdLine}`, {
        op: 'runCommands:start',
        ownerRepo,
        cmdLine,
    });
    let res;
    try {
        res = await exec(cmdLine, { cwd: dir });
    }
    catch (err) {
        const { message, stdout, stderr, code } = err;
        let msg = message.replace(/\s*\n[\s\S]*/, '');
        for (const [name, out] of [
            ['stdout', stdout],
            ['stderr', stderr],
        ]) {
            if (out && out.length > 0) {
                msg += `\n${bold(`>>> ${name} <<<`)}\n${out.trim()}`;
            }
        }
        msg += `\n\n---\nYou may try to fixup ${dir} and then run:\n`;
        msg += `gh pr --no-clone ... <same args> ${ownerRepo}`;
        log(msg, {
            ownerRepo,
            op: 'runCommands:error',
            cmdLine,
            stdout,
            stderr,
            code,
        });
        return false;
    }
    log.tmp(`ran successfully in ${dir}`, {
        op: 'runCommands:ok',
        ownerRepo,
        cmdLine,
        stdout: res.stdout,
        stderr: res.stderr,
    });
    if (!checkChanged)
        return true;
    const status = await git.status();
    let changed = false;
    const data = { ownerRepo, cmdLine };
    let msg = `${green('changes')}:`;
    for (const type of FILE_PROPS) {
        const files = status[type];
        for (const file of files) {
            data[type] = files;
            changed = true;
            msg += `\n  ${type === 'not_added' ? 'A' : type[0].toUpperCase()} ${typeof file === 'string' ? file : `${file.from} → ${file.to}`}`;
        }
    }
    if (changed) {
        data.op = 'runCommands:changed';
        log(msg, data);
    }
    else {
        data.op = 'runCommands:notChanged';
        log(red('not modified'), data);
    }
    return changed;
}
async function buildPRMsg(pjson, filePath, commitMsg, cmdLine) {
    let msg = filePath
        ? await (0, promises_1.readFile)(filePath, 'utf8')
        : (commitMsg || '').replace(/^.*\n*/, '');
    if (/\S/.test(msg))
        msg += '\n\n---\n';
    const versionURL = `${pjson.repository.url}/releases/tag/v${pjson.version}`;
    msg += `This PR created by [\`gh pr -c '${cmdLine}' ...\`](${versionURL})`;
    return msg;
}
function findOpenPR(gh, owner, repo, head) {
    return gh.pulls.list({ owner, repo, head }).then(prs => prs.data[0]);
}
async function cloneRepo(git, dir, ownerRepo, host, log, clone) {
    const repoUrl = `git@${host}:${ownerRepo}.git`;
    if (clone) {
        debug(`rm -rf ${dir}`);
        await rimraf(dir);
        debug(`mkdir -p ${dir}`);
        await (0, promises_1.mkdir)(dir, { recursive: true });
        log.tmp('cloning', { op: 'clone', ownerRepo, dir });
        await git.clone(repoUrl, dir);
    }
    await git.cwd(dir);
    return repoUrl;
}
async function bulkPRCmd(pjson, repos, opts) {
    const { cmdLine, afterCommitCmdLine, commitMsg, commitMsgFile, prMsgFile, cloneBaseDir, commit, branch: explicitBranch, title: explicitTitle, clone, json, buffer, dryRun, } = opts;
    if (!cmdLine)
        throw new Error('Missing required argument --cmd-line');
    if (commit &&
        ((commitMsg && commitMsgFile) || !(commitMsg || commitMsgFile))) {
        throw new Error('Must specify --commit-msg or --commit-msg-file, not both');
    }
    const commitMsgText = commitMsgFile
        ? await (0, promises_1.readFile)(commitMsgFile, 'utf8')
        : commitMsg || '<no commit msg>';
    if (!commit) {
        if (commitMsgText !== '<no commit msg>') {
            throw new Error('Should not supply a commit msg if not committing');
        }
        if (!explicitTitle) {
            throw new Error('Must supply --title if not committing');
        }
    }
    const title = explicitTitle ||
        commitMsgText
            .replace(/\n[\s\S]*/, '')
            .replace(/^(?:fix|chore|docs|test|feat|refactor|style):\s+/, '');
    const branch = explicitBranch || tokenize(title);
    const prMsg = await buildPRMsg(pjson, prMsgFile, commitMsgText, cmdLine);
    const { token, host } = await (0, gh_auth_status_1.default)();
    const ghOpts = {
        auth: token,
        log: {
            debug: () => {
                /* maybe include this? */
            },
            info: debug,
            warn: debug,
            error: debug,
        },
    };
    if (host !== 'github.com')
        ghOpts.baseUrl = `https://${host}/api/v3`;
    const OctokitWithLogging = rest_1.Octokit.plugin(plugin_request_log_1.requestLog);
    const gh = new OctokitWithLogging(ghOpts);
    await (0, promises_1.mkdir)(cloneBaseDir, { recursive: true });
    const { data: { login }, } = await gh.users.getAuthenticated();
    const headBranch = `${login}:${branch}`;
    for (const ownerRepo of repos) {
        const log = (0, logger_1.default)({
            json,
            prefix: bold(`${ownerRepo}: `),
            buffer,
        });
        const [owner, repo] = ownerRepo.split('/');
        const oldPR = await findOpenPR(gh, owner, repo, headBranch);
        if (oldPR) {
            const prURL = oldPR.html_url;
            log(`${bold('existing PR')}: ${underline(prURL)}`, {
                op: 'pr:exists',
                ownerRepo,
                prURL,
            });
            continue;
        }
        const { data: { archived }, } = await gh.repos.get({ owner, repo });
        if (archived) {
            log(bold('archived repo'), { op: 'repo:archived', ownerRepo });
            continue;
        }
        const dir = `${cloneBaseDir}/${ownerRepo}`;
        const git = (0, simple_git_1.simpleGit)(cloneBaseDir);
        const repoUrl = await cloneRepo(git, dir, ownerRepo, host, log, clone);
        const forkUrl = await createForkIfNeeded(gh, git, login, owner, repo, repoUrl, log, clone);
        const baseBranch = await originBranch(git);
        if (clone)
            await git.checkoutLocalBranch(branch);
        else
            await verifyOnBranch(git, branch, dir);
        // try running the -c commands - if no change results, skip rest
        if (commit) {
            if (!(await runCommands(dir, git, cmdLine, log, ownerRepo, true))) {
                continue;
            }
            log.tmp(`committing changes to branch ${branch}`, {
                op: 'commit',
                ownerRepo,
                dir,
                branch,
            });
            await git.add(['--all']);
            await git.commit(commitMsgText, ['--no-verify', '--no-post-rewrite']);
        }
        else {
            log.tmp(`${bold('not')} running cmdline due to --no-commit`, {
                op: 'runCommand:skip',
                cmdLine,
            });
        }
        // don't require changes for this run, but still skip if it fails
        if (afterCommitCmdLine &&
            !(await runCommands(dir, git, afterCommitCmdLine, log, ownerRepo))) {
            continue;
        }
        if (dryRun)
            continue;
        log.tmp(`pushing changes to branch ${branch}`, {
            op: 'push',
            ownerRepo,
            branch,
            forkUrl,
        });
        await git.push(['--force', '--set-upstream', 'fork', branch]);
        const prOpts = {
            owner,
            repo,
            title: `[bulk pr] ${title}`,
            head: headBranch,
            base: baseBranch,
            body: prMsg,
            maintainer_can_modify: true,
        };
        debug('open pr', prOpts);
        const { data: { html_url: prURL }, } = await gh.pulls.create(prOpts);
        log(`${bold('opened PR')}: ${underline(prURL)}`, {
            op: 'pr:created',
            ownerRepo,
            prURL,
            title,
            headBranch,
            baseBranch,
            prMsg,
        });
        debug(`rm -rf ${dir}`);
        await rimraf(dir);
    }
}
exports.default = bulkPRCmd;
