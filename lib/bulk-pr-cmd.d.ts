export interface PackageJson {
    version: string;
    repository: {
        url: string;
    };
}
export interface BulkPROpts {
    json: boolean;
    buffer?: string[];
    cmdLine: string;
    afterCommitCmdLine?: string;
    commitMsg?: string;
    commitMsgFile?: string;
    prMsgFile?: string;
    cloneBaseDir: string;
    commit: boolean;
    branch?: string;
    title?: string;
    clone: boolean;
    dryRun: boolean;
}
export default function bulkPRCmd(pjson: PackageJson, repos: string[], opts: BulkPROpts): Promise<void>;
