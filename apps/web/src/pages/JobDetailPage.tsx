import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { apiFetch, getStoredToken } from '../api';
import { ExternalUrl, statusChip, truncateUrl } from '../jobUi';
import type { JobRow, TaskRow } from '../types';

export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobRow | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [requeueBusy, setRequeueBusy] = useState(false);
  const [requeueTaskId, setRequeueTaskId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!jobId || !getStoredToken()) {
        setError('Missing job id or API token. Save a token on the home page.');
        setLoading(false);
        return;
      }
      if (!opts?.quiet) {
        setLoading(true);
        setError(null);
      } else {
        setRefreshing(true);
      }
      try {
        const r = await apiFetch(`/api/jobs/${jobId}`);
        if (!r.ok) {
          if (r.status === 404) {
            setError('Job not found.');
          } else {
            setError(`Failed to load job: ${r.status}`);
          }
          setJob(null);
          setTasks([]);
          return;
        }
        const data = (await r.json()) as { job: JobRow; tasks: TaskRow[] };
        setJob(data.job);
        setTasks(data.tasks);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [jobId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const requeueableCount = tasks.filter(
    (t) => t.status === 'failed' || t.status === 'in_progress',
  ).length;

  const requeue = async () => {
    if (!jobId || !getStoredToken()) return;
    setMessage(null);
    setError(null);
    setRequeueBusy(true);
    try {
      const r = await apiFetch('/api/jobs/requeue', {
        method: 'POST',
        body: JSON.stringify({ jobId }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        error?: string;
        reset?: number;
      };
      if (!r.ok) {
        setError(body.error || `Re-queue failed: ${r.status}`);
        return;
      }
      const n = typeof body.reset === 'number' ? body.reset : 0;
      setMessage(
        n > 0
          ? `Re-queued ${n} task${n === 1 ? '' : 's'} (failed or in progress).`
          : 'No failed or in-progress tasks to re-queue.',
      );
      await load({ quiet: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRequeueBusy(false);
    }
  };

  const requeueOneTask = async (taskId: string) => {
    if (!getStoredToken()) return;
    setMessage(null);
    setError(null);
    setRequeueTaskId(taskId);
    try {
      const r = await apiFetch('/api/tasks/requeue', {
        method: 'POST',
        body: JSON.stringify({ taskId }),
      });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(body.error || `Re-queue task failed: ${r.status}`);
        return;
      }
      setMessage('Task re-queued.');
      await load({ quiet: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRequeueTaskId(null);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Button variant="outlined" onClick={() => navigate('/')}>
          ← Home
        </Button>
        <Typography variant="h5" component="h1">
          Job details
          {job ? (
            <Typography
              component="span"
              variant="body2"
              color="text.secondary"
              sx={{ ml: 1 }}
            >
              ({job.status})
            </Typography>
          ) : null}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          color="secondary"
          disabled={
            !jobId ||
            loading ||
            refreshing ||
            requeueBusy ||
            requeueTaskId !== null ||
            requeueableCount === 0
          }
          onClick={() => void requeue()}
        >
          {requeueBusy ? 'Re-queueing…' : 'Re-queue failed / stuck'}
        </Button>
        <Button
          variant="outlined"
          disabled={!jobId || loading || refreshing}
          onClick={() => void load({ quiet: true })}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </Stack>

      {message ? (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message}
        </Alert>
      ) : null}

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : job ? (
        <Stack spacing={3}>
          <Paper sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Folder
                </Typography>
                <Typography variant="body2">{job.folderName}</Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  EQD URL
                </Typography>
                <Typography variant="body2">
                  <ExternalUrl href={job.eqdUrl}>{job.eqdUrl}</ExternalUrl>
                </Typography>
              </Box>
              {job.error ? (
                <Alert severity="error">
                  {job.error}
                  {job.errorCode ? ` (${job.errorCode})` : ''}
                </Alert>
              ) : null}
            </Stack>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Tasks ({tasks.length})
            </Typography>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Status</TableCell>
                  <TableCell>Resolver</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell>URL</TableCell>
                  <TableCell>Error</TableCell>
                  <TableCell>Claimed</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{statusChip(t.status)}</TableCell>
                    <TableCell>{t.resolveKind}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {t.sourceNumber != null && t.sourceNumber !== ''
                        ? `[${t.sourceNumber}] `
                        : ''}
                      {t.sourceName}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 320 }}>
                      <ExternalUrl href={t.url}>{truncateUrl(t.url, 96)}</ExternalUrl>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 200, wordBreak: 'break-word' }}>
                      {t.error ||
                        (t.status === 'failed'
                          ? 'Failed (no error message)'
                          : '—')}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
                      {t.claimedAt
                        ? new Date(t.claimedAt).toLocaleString()
                        : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {t.status === 'failed' || t.status === 'in_progress' ? (
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={
                            loading ||
                            refreshing ||
                            requeueBusy ||
                            requeueTaskId !== null
                          }
                          onClick={() => void requeueOneTask(t.id)}
                        >
                          {requeueTaskId === t.id ? '…' : 'Re-queue'}
                        </Button>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {tasks.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                No tasks (job may have failed before tasks were created).
              </Typography>
            ) : null}
          </Paper>
        </Stack>
      ) : (
        <Typography color="text.secondary">Nothing to show.</Typography>
      )}
    </Container>
  );
}
