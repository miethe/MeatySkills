"""Exercise the installer in temporary directories only."""
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import install


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.base=Path(self.tmp.name);self.dest=self.base/'agent-home'/'skills'
    def test_dry_run_writes_nothing(self):
        r=install.install(self.dest,dry_run=True)
        self.assertEqual(len(r),2);self.assertFalse(self.dest.parent.exists())
    def test_installs_both(self):
        r=install.install(self.dest)
        self.assertEqual(len(r),2)
        for name in install.NAMES:self.assertTrue((self.dest/name/'SKILL.md').is_file())
    def test_install_one(self):
        install.install(self.dest,('genre-lyricist',))
        self.assertTrue((self.dest/'genre-lyricist'/'SKILL.md').is_file())
        self.assertFalse((self.dest/'suno-songcraft').exists())
    def test_existing_target_refused(self):
        install.install(self.dest)
        with self.assertRaises(FileExistsError):install.install(self.dest)
    def test_collision_preflight_prevents_partial_write(self):
        (self.dest/'genre-lyricist').mkdir(parents=True)
        with self.assertRaises(FileExistsError):install.install(self.dest)
        self.assertFalse((self.dest/'suno-songcraft').exists())
    def test_replace_preserves_backup_outside_discovery(self):
        install.install(self.dest,('suno-songcraft',))
        marker=self.dest/'suno-songcraft'/'local.txt';marker.write_text('old')
        r=install.install(self.dest,('suno-songcraft',),replace_with_backup=True)
        backup=Path(r[0]['backup'])
        self.assertEqual((backup/'local.txt').read_text(),'old')
        self.assertNotEqual(backup.parent,self.dest)
        self.assertFalse((self.dest/'suno-songcraft'/'local.txt').exists())
    def test_invalid_name(self):
        with self.assertRaises(ValueError):install.install(self.dest,('../escape',))
    def test_duplicate_name(self):
        with self.assertRaises(ValueError):install.install(self.dest,('suno-songcraft','suno-songcraft'))
    def test_no_source_overlap(self):
        with self.assertRaises(ValueError):install.install(install.ROOT/'skills',('suno-songcraft',),replace_with_backup=True)
    def test_does_not_copy_root_agents(self):
        install.install(self.dest)
        self.assertFalse((self.dest/'AGENTS.md').exists())
    def test_excludes_bytecode(self):
        install.install(self.dest)
        self.assertEqual(list(self.dest.rglob('*.pyc')),[])


if __name__=='__main__':unittest.main()
