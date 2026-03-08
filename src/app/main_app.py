import os
import logging
from PyQt5.QtWidgets import QMainWindow, QWidget, QHBoxLayout, QVBoxLayout, QLabel, QPushButton, QStackedWidget
from PyQt5.QtCore import Qt
from src.config.config import MODEL_DIR, MODEL_NAME, STYLE_PATH
from src.core.database import db_manager
from src.core.index_manager import index_manager
from src.core.model_manager import model_image
from src.ui.view.db_page import DBManagementPage
from src.ui.view.search_page import SearchPage
from src.ui.view.settings_page import SettingsPage


class MainApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("ImageSearch Pro")
        self.resize(1100, 800)

        # 核心逻辑初始化
        self.db = db_manager
        logging.info(f"STYLE_PATH: {STYLE_PATH}")
        import sys
        if getattr(sys, 'frozen', False):
            logging.info(f"打包环境: frozen=True, _MEIPASS={getattr(sys, '_MEIPASS', '未设置')}")
        self.load_stylesheet(STYLE_PATH)

        # UI 布局
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        layout = QHBoxLayout(main_widget)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # --- 侧边导航栏 (宽版保留文字) ---
        self.nav_widget = QWidget()
        self.nav_widget.setObjectName("NavWidget")
        self.nav_widget.setFixedWidth(200)  # 宽度恢复到 200
        nav_layout = QVBoxLayout(self.nav_widget)
        nav_layout.setContentsMargins(12, 30, 12, 12)  # 增加内边距
        nav_layout.setSpacing(10)

        # 顶部 Logo 区域
        logo_label = QLabel("ImageSearch")
        logo_label.setObjectName("SidebarLogo")
        logo_label.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        logo_label.setStyleSheet("font-size: 20px; font-weight: bold; color: #6200EE; margin: 0 10px 30px 10px;")
        nav_layout.addWidget(logo_label)

        # 导航按钮 (带图标和文字)
        self.btn_search = self.create_nav_btn("  🚀   图像搜索")
        self.btn_db = self.create_nav_btn("  📂   数据管理")
        self.btn_sets = self.create_nav_btn("  ⚙️   系统设置")

        self.nav_btns = [self.btn_search, self.btn_db, self.btn_sets]
        for btn in self.nav_btns:
            nav_layout.addWidget(btn)

        nav_layout.addStretch()

        # 底部版本号
        version_label = QLabel("v 0.0.1")
        version_label.setStyleSheet("color: #6200EE; font-weight: bold; margin-left: 10px;")
        nav_layout.addWidget(version_label)

        layout.addWidget(self.nav_widget)

        # --- 右侧内容区 ---
        self.stack = QStackedWidget()
        layout.addWidget(self.stack)

        self.stack.addWidget(SearchPage())
        self.stack.addWidget(DBManagementPage())
        self.stack.addWidget(SettingsPage())

        # 绑定事件
        self.btn_search.clicked.connect(lambda: self.switch_page(0))
        self.btn_db.clicked.connect(lambda: self.switch_page(1))
        self.btn_sets.clicked.connect(lambda: self.switch_page(2))

        self.switch_page(0)

    def create_nav_btn(self, text):
        btn = QPushButton(text)
        btn.setObjectName("NavBtn")
        btn.setFixedHeight(50)  # 设置一个合适的高度
        btn.setCursor(Qt.PointingHandCursor)
        return btn

    def load_stylesheet(self, file_path):
        import sys

        logging.info(f"尝试加载样式文件: {file_path}")

        # 收集所有可能的路径
        possible_paths = []

        # 1. 原始路径
        possible_paths.append(file_path)

        # 2. 如果是打包环境，检查 _MEIPASS 相关路径
        if getattr(sys, 'frozen', False):
            meipass = getattr(sys, '_MEIPASS', '')
            if meipass:
                # 标准打包路径
                possible_paths.append(os.path.join(meipass, "resources", "assets", "style.qss"))
                # 可能的不同子目录
                possible_paths.append(os.path.join(meipass, "_internal", "resources", "assets", "style.qss"))
                # 直接在内置目录下
                possible_paths.append(os.path.join(meipass, "style.qss"))

            # 3. 相对于可执行文件的路径
            if hasattr(sys, 'executable'):
                exe_dir = os.path.dirname(sys.executable)
                possible_paths.append(os.path.join(exe_dir, "_internal", "resources", "assets", "style.qss"))
                possible_paths.append(os.path.join(exe_dir, "resources", "assets", "style.qss"))
                possible_paths.append(os.path.join(exe_dir, "style.qss"))

        # 4. 相对于当前文件的路径（开发环境）
        base_dir = os.path.dirname(os.path.abspath(__file__))
        possible_paths.append(os.path.join(os.path.dirname(base_dir), "..", "resources", "assets", "style.qss"))
        possible_paths.append(os.path.join(os.path.dirname(base_dir), "..", "..", "resources", "assets", "style.qss"))
        possible_paths.append(os.path.join(os.path.dirname(base_dir), "..", "..", "..", "resources", "assets", "style.qss"))

        # 5. 相对于项目根目录的路径
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(base_dir)))
        possible_paths.append(os.path.join(project_root, "resources", "assets", "style.qss"))

        # 记录所有路径
        logging.info(f"将检查以下路径:")
        for i, path in enumerate(possible_paths):
            logging.info(f"  [{i}] {path}")

        # 尝试每个路径
        loaded = False
        for path in possible_paths:
            if os.path.exists(path):
                logging.info(f"✅ 找到样式文件: {path}")
                logging.info(f"   文件大小: {os.path.getsize(path)} 字节")
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        content = f.read()
                        self.setStyleSheet(content)
                        logging.info(f"✅ 样式加载成功，长度: {len(content)} 字符")
                        loaded = True
                        break
                except Exception as e:
                    logging.error(f"❌ 加载样式文件失败 {path}: {e}")
            else:
                logging.debug(f"❌ 文件不存在: {path}")

        if not loaded:
            logging.warning("⚠️  未找到样式文件，使用内联基本样式")
            # 使用内联基本样式作为回退
            basic_style = """
            QMainWindow, #MainStack {
                background-color: #F7F8FA;
            }
            #NavWidget {
                background-color: #F7F8FA;
                border-right: none;
            }
            QPushButton#NavBtn {
                border: none;
                border-radius: 10px;
                padding-left: 15px;
                text-align: left;
                font-size: 15px;
                height: 50px;
                font-weight: normal;
                color: #4A4A4A;
                background-color: transparent;
            }
            QPushButton#NavBtn:hover {
                background-color: #EAECEF;
            }
            QPushButton#ActiveNav {
                background-color: #E1D3F7;
                color: #6200EE;
                border-left: 4px solid #6200EE;
                padding-left: 11px;
            }
            """
            self.setStyleSheet(basic_style)
            logging.info("✅ 已应用内联基本样式")

    def switch_page(self, index):
        self.stack.setCurrentIndex(index)
        for i, btn in enumerate(self.nav_btns):
            btn.setObjectName("ActiveNav" if i == index else "NavBtn")
            btn.style().unpolish(btn)
            btn.style().polish(btn)