import py_compile
import sys

try:
    py_compile.compile('main.py', doraise=True)
    print('[OK] Syntax check passed - main.py is valid')
    sys.exit(0)
except SyntaxError as e:
    print(f'[ERROR] Syntax error in main.py:')
    print(f'  Line {e.lineno}: {e.msg}')
    print(f'  {e.text}')
    sys.exit(1)
