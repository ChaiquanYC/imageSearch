# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all
import os
import glob

# 1. 路径配置
import sys
env_path = os.path.dirname(sys.executable)  # Python安装目录
env_bin = os.path.join(env_path, 'Library', 'bin') if os.path.exists(os.path.join(env_path, 'Library', 'bin')) else env_path
project_root = os.getcwd()

# 只打包样式文件，data目录由程序运行时自动创建
datas = []

# 添加样式文件
style_qss = 'resources/assets/style.qss'
if os.path.exists(style_qss):
    datas.append((style_qss, 'resources/assets'))
else:
    print(f"警告: 样式文件 '{style_qss}' 不存在，跳过...")
binaries = []

# 添加NumPy核心二进制文件（.pyd文件）
try:
    import numpy
    numpy_path = numpy.__path__[0]
    # 查找所有的.pyd文件，特别是_multiarray相关的
    numpy_pyd_files = glob.glob(os.path.join(numpy_path, 'core', '_multiarray_*.pyd'))
    for pyd_file in numpy_pyd_files:
        binaries.append((pyd_file, 'numpy/core'))
        datas.append((pyd_file, 'numpy/core'))  # 同时作为数据文件添加
        print(f"添加NumPy二进制文件: {os.path.basename(pyd_file)} -> numpy/core (同时添加到binaries和datas)")
    print(f"总计添加 {len(numpy_pyd_files)} 个NumPy二进制文件")
except Exception as e:
    print(f"警告: 无法添加NumPy二进制文件: {e}")

hiddenimports = [
    'numpy.core._multiarray_umath',
    'numpy.core._multiarray_tests',
    'numpy.random.common',
    'numpy.random.bounded_integers',
    'numpy.random.entropy',
    'numpy.core._dtype_ctypes'
]

# 2. 收集零件
for lib in ['torch', 'torchvision', 'faiss', 'numpy', 'PyQt5']:
    tmp_ret = collect_all(lib)
    datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

# 3. 核心补丁
needed_dlls = ['libiomp5md.dll', 'mkl_rt.2.dll', 'mkl_core.2.dll', 'mkl_intel_thread.2.dll', f'python{sys.version_info.major}{sys.version_info.minor}.dll']
for dll in needed_dlls:
    src = os.path.join(env_bin, dll) if os.path.exists(os.path.join(env_bin, dll)) else os.path.join(env_path, dll)
    if os.path.exists(src):
        binaries.append((src, '.'))

a = Analysis(
    ['main.py'],
    pathex=[env_bin, os.path.join(env_path, 'Lib', 'site-packages')],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    # 优化点 1：排除掉占位置的大型无关模块
    excludes=['matplotlib', 'notebook', 'scipy', 'pandas', 'IPython', 'tensorboard', 'jedi', 'tkinter', 'tests',
              # 排除不必要的PyQt5模块以加速打包
              'PyQt5.QtXml', 'PyQt5.QtXmlPatterns', 'PyQt5.QtWebEngine', 'PyQt5.QtWebEngineCore', 'PyQt5.QtWebEngineWidgets',
              'PyQt5.QtMultimedia', 'PyQt5.QtMultimediaWidgets', 'PyQt5.QtNetwork', 'PyQt5.QtSql',
              'PyQt5.QtSerialPort', 'PyQt5.QtSensors', 'PyQt5.QtBluetooth', 'PyQt5.QtLocation',
              'PyQt5.QtWebSockets', 'PyQt5.Qt3DCore', 'PyQt5.Qt3DExtras', 'PyQt5.Qt3DInput', 'PyQt5.Qt3DLogic', 'PyQt5.Qt3DRender',
              # 排除更多不必要的Qt模块（平台特定和非必需模块）
              'PyQt5.QtWinExtras', 'PyQt5.QtTest', 'PyQt5.QtHelp', 'PyQt5.QtOpenGL', 'PyQt5.QtPrintSupport',
              'PyQt5.QtDBus', 'PyQt5.QtX11Extras', 'PyQt5.QtMacExtras', 'PyQt5.QtScript', 'PyQt5.QtScriptTools'],
    noarchive=False,
)

# 删掉 GPU 相关 DLL和不必要的Qt模块
blacklist = [
    'nvrtc', 'cuda', 'cudnn', 'cublas', 'curand', 'cusolver', 'cusparse', 'cufft', # GPU 相关
    'mkl_avx512', 'mkl_vml_avx512',
    'libxml2', 'libxslt', 'icu',
    # 排除不必要的Qt模块
    'qt5bluetooth', 'bluetooth',  # 蓝牙模块
    'qt5xml', 'xml', 'qt5xmlpatterns', 'xmlpatterns',  # XML模块
    'qt5webengine', 'webengine',  # Web引擎
    'qt5multimedia', 'multimedia',  # 多媒体
    'qt5network',  # 网络
    'qt5sql',  # SQL
    'qt5serialport',  # 串口
    'qt5sensors',  # 传感器
    'qt5location',  # 位置
    'qt5websockets',  # WebSocket
    'qt53d', 'qt53dcore', 'qt53dextras', 'qt53dinput', 'qt53dlogic', 'qt53drender',  # 3D模块
    'qt5quick', 'qt5qml',  # QML/Quick
    # 排除更多平台特定和非必需模块
    'qt5winextras', 'winextras',  # Windows扩展模块
    'qt5test',  # Qt测试模块 (移除通用的'test'，避免排除NumPy的_multiarray_tests)
    'qt5help', 'help',  # 帮助模块
    'qt5opengl', 'opengl',  # OpenGL模块
    'qt5printsupport', 'printsupport',  # 打印支持
    'qt5dbus', 'dbus',  # D-Bus（Linux）
    'qt5x11extras', 'x11extras',  # X11扩展（Linux）
    'qt5macextras', 'macextras',  # macOS扩展
    'qt5script', 'script', 'qt5scripttools', 'scripttools',  # 脚本模块
]

a.binaries = [x for x in a.binaries if not any(b in os.path.basename(x[1]).lower() for b in blacklist)]
a.datas = [x for x in a.datas if not any(b in x[0].lower() for b in blacklist)]
# =========================================================

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='ImageSearch',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,        # 禁用strip，避免Qt DLL处理错误
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    icon=None,           # 如果你有 ico 图标可以加在这里
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,        # 禁用strip，避免Qt DLL处理错误
    upx=False,
    name='ImageSearch',
)