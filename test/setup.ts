// Times in tests read in UTC, whatever zone the machine is in. A test that needs another zone sets process.env.TZ
// itself (Node applies it at once) and puts it back afterwards.
process.env.TZ = 'UTC';
