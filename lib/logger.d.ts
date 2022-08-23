export interface Logger {
    (message: string, data: unknown): void;
    tmp(message: string, data: unknown): void;
}
export default function makeLogger({ json, prefix, buffer, }: {
    json: boolean;
    prefix?: string;
    buffer?: string[];
}): Logger;
