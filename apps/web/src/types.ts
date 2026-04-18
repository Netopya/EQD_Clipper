export type JobRow = {
  id: string;
  eqdUrl: string;
  folderName: string;
  status: string;
  error?: string;
  errorCode?: string;
  createdAt?: string;
  updatedAt?: string;
  taskCounts?: {
    total: number;
    pending: number;
    completed: number;
    failed: number;
  };
};

export type TaskRow = {
  id: string;
  jobId: string;
  url: string;
  resolveKind: string;
  folderName: string;
  sourceNumber?: string;
  sourceName: string;
  status: string;
  error?: string;
  claimedAt?: string;
};
