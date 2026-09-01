import { useEffect, useMemo, useState } from 'react';
import { KeyRound, ShieldOff, Users } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatTime } from '../../lib/format.js';
import PageHeader from '../../components/PageHeader.jsx';
import Card from '../../components/Card.jsx';
import Alert from '../../components/Alert.jsx';
import Avatar from '../../components/Avatar.jsx';
import Badge from '../../components/Badge.jsx';
import DataTable from '../../components/DataTable.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import StatTile, { StatGrid } from '../../components/StatTile.jsx';
import { usePageSearch } from '../../components/Layout.jsx';

export default function AdminKeys() {
  const [keys, setKeys] = useState(null);
  const [includeRevoked, setIncludeRevoked] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const query = usePageSearch('Search by owner, roll number or key ID');

  const load = (revoked) =>
    api
      .listKeys(revoked)
      .then((data) => setKeys(data.keys))
      .catch((err) => setError(err.message));

  useEffect(() => {
    load(includeRevoked);
  }, [includeRevoked]);

  const revoke = async (key) => {
    setError(null);
    setNotice(null);
    try {
      await api.revokeKey(key.id);
      setNotice(
        `Revoked ${key.kid} for ${key.ownerName}. Their next scan will be denied with KEY_REVOKED.`,
      );
      await load(includeRevoked);
    } catch (err) {
      setError(err.message);
    }
  };

  const active = (keys ?? []).filter((key) => key.active);
  const stats = {
    active: active.length,
    revoked: (keys ?? []).length - active.length,
    owners: new Set(active.map((key) => key.ownerName)).size,
  };

  const filtered = useMemo(() => {
    if (!keys) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) return keys;
    return keys.filter((key) =>
      [key.ownerName, key.rollNo, key.ownerUsername, key.kid]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [keys, query]);

  const columns = [
    {
      key: 'owner',
      header: 'Owner',
      render: (key) => (
        <div className="cell-person">
          <Avatar name={key.ownerName} size="sm" />
          <div className="who">
            <strong>{key.ownerName}</strong>
            <small className="mono">{key.rollNo ?? key.ownerUsername}</small>
          </div>
        </div>
      ),
    },
    { key: 'kid', header: 'Key ID', className: 'mono' },
    { key: 'algorithm', header: 'Algorithm', className: 'muted' },
    { key: 'publicPreview', header: 'Public point', className: 'mono muted' },
    {
      key: 'createdAt',
      header: 'Enrolled',
      className: 'muted',
      render: (key) => formatTime(key.createdAt),
    },
    {
      key: 'status',
      header: 'Status',
      render: (key) => (
        <>
          <Badge tone={key.active ? 'grant' : 'deny'}>{key.active ? 'active' : 'revoked'}</Badge>
          {!key.active && key.revokedAt && (
            <div className="muted" style={{ fontSize: '0.74rem' }}>
              {formatTime(key.revokedAt)}
            </div>
          )}
        </>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (key) =>
        key.active && (
          <button className="danger small" onClick={() => revoke(key)}>
            Revoke
          </button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Public key registry"
        subtitle="The simulated certificate authority. Only public keys are stored — a private key never reaches this server, so it cannot be leaked from here."
        actions={
          <button
            className="secondary"
            onClick={() => setIncludeRevoked((value) => !value)}
            aria-pressed={includeRevoked}
          >
            {includeRevoked ? 'Hide revoked' : 'Show revoked'}
          </button>
        }
      />

      <StatGrid>
        <StatTile
          tone="hero"
          label="Active keys"
          value={stats.active}
          icon={<KeyRound size={15} />}
          hint="One per student, enforced by the schema"
        />
        <StatTile
          label="Revoked"
          value={stats.revoked}
          icon={<ShieldOff size={15} />}
          hint="Denied on the next scan"
        />
        <StatTile
          label="Students covered"
          value={stats.owners}
          icon={<Users size={15} />}
          hint="Holding a usable credential"
        />
      </StatGrid>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card
        title="Enrolled keys"
        subtitle="Revocation is immediate and takes effect on the very next verification."
        action={<span className="muted">{filtered?.length ?? 0} shown</span>}
      >
        <DataTable
          columns={columns}
          rows={filtered}
          loading={!keys}
          empty={
            <EmptyState icon={KeyRound} title="No keys enrolled">
              {query
                ? 'No key matches that search.'
                : 'Students enrol their own device keys from their entry-pass screen.'}
            </EmptyState>
          }
        />
      </Card>
    </>
  );
}
