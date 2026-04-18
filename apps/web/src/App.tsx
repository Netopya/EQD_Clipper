import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Container,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  apiFetch,
  fetchBootstrap,
  getStoredToken,
  setStoredToken,
} from './api';

type JobRow = {
  id: string;
  eqdUrl: string;
  folderName: string;
  status: string;
  error?: string;
  taskCounts?: {
    total: number;
    pending: number;
    completed: number;
    failed: number;
  };
};

export default function App() {
  const [token, setToken] = useState(getStoredToken);
  const [twitterDelayMs, setTwitterDelayMs] = useState(8000);
  const [eqdUrl, setEqdUrl] = useState('');
  const [folderName, setFolderName] = useState('8');
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshBootstrap = useCallback(async () => {
    try {
      const b = await fetchBootstrap();
      setTwitterDelayMs(b.twitterDelayMs);
      if (!getStoredToken()) {
        setToken(b.apiToken);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    if (!getStoredToken()) return;
    const r = await apiFetch('/api/jobs');
    if (!r.ok) {
      setError(`Jobs list failed: ${r.status}`);
      return;
    }
    setJobs(await r.json());
  }, []);

  useEffect(() => {
    void refreshBootstrap();
  }, [refreshBootstrap]);

  useEffect(() => {
    if (!getStoredToken()) return;
    void refreshJobs();
    const id = setInterval(() => {
      if (getStoredToken()) void refreshJobs();
    }, 8000);
    return () => clearInterval(id);
  }, [refreshJobs, token]);

  const saveToken = () => {
    setStoredToken(token.trim());
    setMessage('Token saved. Use the same value in the Chrome extension.');
    setError(null);
    void refreshJobs();
  };

  const saveTwitterDelay = async () => {
    const r = await apiFetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ twitterDelayMs: Number(twitterDelayMs) || 0 }),
    });
    if (!r.ok) {
      setError(`Settings failed: ${r.status}`);
      return;
    }
    setMessage('Rate limit setting saved.');
    setError(null);
  };

  const createJob = async () => {
    setError(null);
    setMessage(null);
    const r = await apiFetch('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        eqdUrl: eqdUrl.trim(),
        folderName: folderName.trim() || '8',
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(
        (body as { error?: string }).error ||
          `Create job failed: ${r.status}`,
      );
      return;
    }
    setMessage('Job created. Ensure the Chrome extension is polling.');
    setEqdUrl('');
    void refreshJobs();
  };

  const rotateToken = async () => {
    const r = await apiFetch('/api/auth/rotate', { method: 'POST' });
    if (!r.ok) {
      setError(`Rotate failed: ${r.status}`);
      return;
    }
    const j = (await r.json()) as { apiToken: string };
    setToken(j.apiToken);
    setStoredToken(j.apiToken);
    setMessage('New token issued; extension must be updated too.');
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        EQD Clipper
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Companion dashboard. Run the API server, open this page in any
        browser, and load the extension in Chrome. Downloads stay in Chrome.
      </Typography>

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

      <Stack spacing={3}>
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            API token
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            On first launch the server creates a token in{' '}
            <code>data/state.json</code>. Paste it into the Chrome extension
            and save it here for the dashboard.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              label="Bearer token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              fullWidth
              size="small"
              autoComplete="off"
            />
            <Button variant="contained" onClick={saveToken}>
              Save token
            </Button>
            <Button variant="outlined" color="warning" onClick={() => void rotateToken()}>
              Rotate token
            </Button>
          </Stack>
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Rate limits
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="flex-start">
            <TextField
              label="Min ms between Twitter/X tasks (server-side)"
              type="number"
              value={twitterDelayMs}
              onChange={(e) => setTwitterDelayMs(Number(e.target.value))}
              size="small"
              sx={{ minWidth: 280 }}
            />
            <Button variant="outlined" onClick={() => void saveTwitterDelay()}>
              Save
            </Button>
          </Stack>
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            New job
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="EQD post URL"
              value={eqdUrl}
              onChange={(e) => setEqdUrl(e.target.value)}
              fullWidth
              size="small"
              placeholder="https://www.equestriadaily.com/2024/01/..."
            />
            <TextField
              label="Download folder name (under eqdc/)"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              size="small"
              sx={{ maxWidth: 360 }}
            />
            <Box>
              <Button variant="contained" onClick={() => void createJob()}>
                Queue EQD post
              </Button>
            </Box>
          </Stack>
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography variant="h6">Jobs</Typography>
            <Button size="small" onClick={() => void refreshJobs()}>
              Refresh
            </Button>
          </Stack>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Status</TableCell>
                <TableCell>Folder</TableCell>
                <TableCell>URL</TableCell>
                <TableCell>Tasks</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {jobs.map((j) => (
                <TableRow key={j.id}>
                  <TableCell>{j.status}</TableCell>
                  <TableCell>{j.folderName}</TableCell>
                  <TableCell sx={{ maxWidth: 280, wordBreak: 'break-all' }}>
                    {j.eqdUrl}
                  </TableCell>
                  <TableCell>
                    {j.taskCounts
                      ? `${j.taskCounts.completed}/${j.taskCounts.total} done, ${j.taskCounts.pending} pending, ${j.taskCounts.failed} failed`
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
              {jobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    No jobs yet. Save a token and create a job.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Paper>
      </Stack>
    </Container>
  );
}
