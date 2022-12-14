import assert from 'assert';
import { execFile as execFileCb } from 'child_process';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

describe('cli wrapper', function () {
  this.timeout(30000); // plenty of time for npm ci

  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(`${tmpdir()}/wrapper-test`);
    await execFile('git', ['clone', `${__dirname}/..`, dir]);
  });

  it('installs dependencies once on demand and shows help', async () => {
    const run1 = await execFile(`${dir}/gh-bulk-pr`, ['--help']);
    assert.match(run1.stdout, /--commit-msg/);
    assert.match(run1.stderr, /dependency installation/); // now run again and make sure it doesn't reinstall

    const run2 = await execFile(`${dir}/gh-bulk-pr`, ['--help']);
    assert.match(run2.stdout, /--commit-msg/);
    assert.doesNotMatch(run2.stderr, /dependency installation/);
  });
});
