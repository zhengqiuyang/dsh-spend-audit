export interface LoadedLog {
    text: string;
    compression: 'none' | 'zstd';
}
export declare function loadSessionLog(path: string): Promise<LoadedLog>;
