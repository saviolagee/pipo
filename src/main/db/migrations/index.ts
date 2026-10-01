// Migrações versionadas, aplicadas em ordem via PRAGMA user_version.
import m001 from './001_init';
import m002 from './002_days';

const migrations: string[] = [m001, m002];

export default migrations;
