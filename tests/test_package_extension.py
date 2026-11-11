from pathlib import Path
import json
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from package_extension import build


class PackageTests(unittest.TestCase):
    def fixture(self,base):
        source=base/'extension'
        source.mkdir()
        (source/'manifest.json').write_text(json.dumps({'manifest_version':3,'version':'1.0.0','action':{'default_popup':'popup.html'}}),encoding='utf-8')
        (source/'popup.html').write_text('<h1>Synthetic extension</h1>',encoding='utf-8')
        (base/'LICENSE').write_text('MIT License\n\nSynthetic copyright\n',encoding='utf-8')
        return source

    def test_archive_has_root_manifest_license_and_no_development_files(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder); source=self.fixture(base)
            (source/'node_modules').mkdir()
            (source/'node_modules'/'synthetic.txt').write_text('development only',encoding='utf-8')
            output=base/'dist'/'extension.zip'
            report=build(source,output,license_file=base/'LICENSE')
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(set(archive.namelist()),{'manifest.json','popup.html','LICENSE'})
                self.assertIsNone(archive.testzip())
            self.assertEqual(report['version'],'1.0.0')

    def test_missing_declared_resource_prevents_package_creation(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder); source=self.fixture(base)
            manifest=json.loads((source/'manifest.json').read_text(encoding='utf-8'))
            manifest['options_page']='missing.html'
            (source/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
            output=base/'extension.zip'
            with self.assertRaisesRegex(ValueError,'Missing or excluded'):
                build(source,output)
            self.assertFalse(output.exists())

    def test_existing_package_is_preserved_and_output_inside_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder); source=self.fixture(base)
            output=base/'extension.zip'
            build(source,output)
            original=output.read_bytes()
            (source/'popup.html').write_text('<h1>Changed</h1>',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'Different package exists'):
                build(source,output)
            self.assertEqual(output.read_bytes(),original)
            with self.assertRaisesRegex(ValueError,'outside the source'):
                build(source,source/'extension.zip')


if __name__=='__main__':
    unittest.main()
