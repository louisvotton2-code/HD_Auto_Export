import errno, importlib.util, pathlib, unittest, tempfile, os, sys, subprocess
from unittest.mock import patch,MagicMock
s=importlib.util.spec_from_file_location('capture',pathlib.Path(__file__).with_name('capture-existing.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
class StopWindowTests(unittest.TestCase):
 def test_listening_api_and_permission_error_both_refuse(self):
  for status in [0,errno.EPERM,errno.ETIMEDOUT]:
   sock=MagicMock();sock.__enter__.return_value.connect_ex.return_value=status
   with patch.object(c.socket,'socket',return_value=sock),self.assertRaises(ValueError):c.ensure_api_stopped(3320)
 def test_hardlinked_media_capture_fails_without_success_directory(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);media=root/'media';media.mkdir(mode=0o700)
   f=media/'01234567-0123-4123-8123-012345678901.webp';f.write_bytes(b'image');f.chmod(0o600)
   os.link(f,media/'01234567-0123-4123-8123-012345678902.webp')
   env=root/'source.env';env.write_text(f'DATABASE_URL=postgresql://test:unused@127.0.0.1/testdb\nMEDIA_ROOT={media}\n')
   args=['capture','--source-env',str(env),'--database-container','test-pg','--release-id','test','--backup',str(root/'backup')]
   with patch.object(sys,'argv',args),patch.object(c,'ensure_api_stopped'),patch.object(c.subprocess,'run',return_value=subprocess.CompletedProcess([],0)),self.assertRaises(ValueError):c.main()
   self.assertFalse((root/'backup').exists())
 def test_actual_refused_connection_is_required(self):
  sock=MagicMock();sock.__enter__.return_value.connect_ex.return_value=errno.ECONNREFUSED
  with patch.object(c.socket,'socket',return_value=sock):c.ensure_api_stopped(3320)
if __name__=='__main__':unittest.main()
