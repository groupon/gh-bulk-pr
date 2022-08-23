import assert from 'assert';
import { mkdir, mkdtemp, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';

import { DeclarativeNock } from 'declarative-nock';
import type { Octokit } from '@octokit/rest';

import bulkPRCmd, { type BulkPROpts } from '../lib/bulk-pr-cmd';

const CREATE_PR = 'post /repos/org/{repo}/pulls';
const dn = new DeclarativeNock({
  github: {
    url: 'https://api.github.com',
    mocks: {
      'get /user': { body: { login: 'testuser' } },

      'get /repos/org/{repo}/pulls': ({ params: { repo } }) => ({
        body:
          repo === 'haspulls'
            ? [{ html_url: 'https://github.com/org/repo1/pull/42' }]
            : [],
      }),

      'get /repos/org/{repo}': ({ params: { repo } }) => ({
        body: { archived: repo === 'archived' },
      }),

      'post /repos/org/{repo}/forks': ({ params: { repo } }) => ({
        body: {
          ssh_url: `git@github.com:org/${repo}.git`,
          created_at: 0, // a "long time ago": no delay needed
        },
      }),

      [CREATE_PR]: ({ params: { repo } }) => ({
        body: { html_url: `https://github.com/org/${repo}/pull/1` },
      }),
    },
  },
});
const { github } = dn.origins;

const pjson = {
  version: '1.0.0',
  repository: { url: 'https://github.com/groupon/gh-bulk-pr' },
};

interface LogJson {
  t: number;
  data: {
    op: string;
    [prop: string]: any;
  };
}

type CreatePROpts = Exclude<
  Parameters<Octokit['pulls']['create']>[0],
  undefined
>;

function rcvdPROpts() {
  return github.one(CREATE_PR).body as CreatePROpts;
}

function assertNoPR() {
  assert.strictEqual(
    github.all(CREATE_PR).length,
    0,
    'Should not have created a PR'
  );
}

describe('bulkPRCmd()', () => {
  dn.addMochaHooks();

  const opts: BulkPROpts = {
    buffer: [],
    json: true,
    cmdLine: 'echo changes >> README.md',
    clone: true,
    cloneBaseDir: 'will-be-replaced-in-beforeEach',
    commitMsg: 'default commit msg',
    dryRun: false,
    commit: true,
  };

  // inject our mocks dir into the front of PATH so that when "gh" is exec'ed
  // we get our mock version that responds with plausible-looking auth status
  before(() => {
    process.env.PATH = `${__dirname}/../mocks:${process.env.PATH || '/bin'}`;
  });

  after(() => {
    process.env.PATH = (process.env.PATH || '.:/bin').replace(/^[^:]+:/, '');
  });

  beforeEach(async () => {
    opts.cloneBaseDir = await mkdtemp(`${tmpdir()}/pr-test`);
  });

  beforeEach(() => {
    opts.buffer = [];
  });

  async function runBulkPR(
    repos: string[],
    optOverrides: Partial<BulkPROpts> & { json: false }
  ): Promise<string[]>;
  async function runBulkPR(
    repos: string[],
    optOverrides?: Partial<BulkPROpts>
  ): Promise<LogJson[]>;
  async function runBulkPR(
    repos: string[],
    optOverrides: Partial<BulkPROpts> = {}
  ) {
    const prOpts = { ...opts, ...optOverrides };
    await bulkPRCmd(pjson, repos, prOpts);
    const lines = (opts.buffer || []).map(line => line.trim());
    return prOpts.json ? lines.map(line => JSON.parse(line) as LogJson) : lines;
  }

  it('respects --dry-run', async () => {
    const logs = await runBulkPR(['org/repo1'], { dryRun: true });
    assertNoPR();

    const lastLog = logs[logs.length - 1];
    assert.strictEqual(lastLog.data.op, 'commit');
    const dir = lastLog.data.dir as string;
    const readme = await readFile(`${dir}/README.md`, 'utf8');
    assert.match(readme, /changes/, 'was actually modified');
  });

  it('respects --no-clone', async () => {
    await mkdir(`${opts.cloneBaseDir}/org/repo1`, { recursive: true });
    await writeFile(`${opts.cloneBaseDir}/org/repo1/README.md`, 'existing\n');
    const logs = await runBulkPR(['org/repo1'], { clone: false });
    rcvdPROpts();
    assert.ok(!logs.some(log => log.data.op === 'clone'));
  });

  it('respects --no-commit', async () => {
    const logs = await runBulkPR(['org/repo1'], {
      commit: false,
      commitMsg: undefined,
      title: 'a pr title',
    });
    assert.strictEqual(rcvdPROpts().title, '[bulk pr] a pr title');
    assert.ok(!logs.some(log => log.data.op === 'commit'));
  });

  it('respects --commit-msg-file', async () => {
    const commitMsg = 'commit msg from file\n\nfor you\n';
    const commitMsgFile = `${opts.cloneBaseDir}/../commit-msg`;
    await writeFile(commitMsgFile, commitMsg);
    await runBulkPR(['org/repo1'], {
      commitMsg: undefined,
      commitMsgFile,
    });
    const { body, head } = rcvdPROpts();
    assert.strictEqual(head, 'testuser:commit-msg-from-file');
    assert.ok(body?.startsWith('for you\n'));
  });

  it('does not open a PR if there is one open', async () => {
    await runBulkPR(['org/haspulls']);
    assertNoPR();
  });

  it('noops if there are no resulting modifications', async () => {
    const logs = await runBulkPR(['org/repo1'], { cmdLine: 'true' });
    assertNoPR();
    assert.ok(logs.some(log => log.data.op === 'runCommands:notChanged'));
  });

  it('accepts a bunch of overrides', async () => {
    const prMsg = 'custom\nPR\nmsg\n';
    const prMsgFile = `${opts.cloneBaseDir}/../pr-msg`;
    await writeFile(prMsgFile, prMsg);
    const logs = await runBulkPR(['org/repo1'], {
      json: false,
      afterCommitCmdLine: 'echo yay',
      title: 'custom title',
      branch: 'custom-branch',
      prMsgFile,
    });
    assert.match(logs[logs.length - 1], /opened PR.*pull\/1/);
    assert.match(rcvdPROpts().body || '', /custom\nPR\nmsg/);
  });
});
