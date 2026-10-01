// Migrações versionadas, aplicadas em ordem via PRAGMA user_version.
import m001 from './001_init';

const migrations: string[] = [m001];

export default migrations;
