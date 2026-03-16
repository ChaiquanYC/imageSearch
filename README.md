# ImageSearch

一个基于 **DINOv2 + FAISS + PyQt5** 的本地图像检索与图库管理客户端。

ImageSearch 不只是一个“以图搜图 Demo”，而是一个完整的本地图库工作台：
- 使用 **DINOv2** 提取图像特征
- 使用 **FAISS** 执行相似图检索
- 使用 **SQLite** 管理图片路径、描述和向量数据
- 使用 **PyQt5** 提供可视化桌面界面

所有核心数据都保存在本地目录中，适合做私有图库管理、素材检索、设计参考图归档等场景。

---

## 页面

### 1. 主页

![image-20260316230551520](https://cdn.jsdelivr.net/gh/ChaiquanYC/imageRepository@main/img/20260316230551557.png)

### 2.图像管理

![image-20260316230809111](https://cdn.jsdelivr.net/gh/ChaiquanYC/imageRepository@main/img/20260316230809156.png)

### 3.系统设置

![image-20260316230833068](https://cdn.jsdelivr.net/gh/ChaiquanYC/imageRepository@main/img/20260316230833109.png)

## 功能特性

### 1. 本地以图搜图
- 支持上传 `jpg / jpeg / png` 作为查询图
- 基于 DINOv2 提取视觉特征
- 使用 FAISS 进行向量检索
- 返回相似图片列表，并展示：
  - 图片预览
  - 描述信息
  - 本地路径
  - 匹配度

### 2. 图库管理
- 批量导入图片入库
- 导入时自动复制到统一存储目录
- 自动提取特征并写入数据库
- 实时同步到 FAISS 索引
- 支持批量删除图片
- 支持批量添加描述
- 支持在表格中直接双击修改描述

### 3. 数据统计与分页浏览
- 展示总记录数
- 展示有描述图片占比
- 展示已有向量图片占比
- 展示图片时间范围
- 支持分页查看图库数据
- 支持调整每页显示数量与页码跳转

### 4. 模型与路径配置
- 支持切换 DINOv2 模型规模
- 支持修改模型目录
- 支持修改图片存储目录
- 支持修改数据库目录
- 切换模型后自动清空旧向量并全量重建索引
- 修改存储目录后自动同步数据库中的图片路径

### 5. 本地优先
- 模型、图片、数据库均默认保存在本地 `data/` 目录
- 配置项保存在 `settings.json`
- 启动时自动加载模型与数据库向量索引

---

## 技术栈

- **视觉特征提取**：DINOv2
- **向量检索**：FAISS
- **桌面界面**：PyQt5
- **数据存储**：SQLite3
- **深度学习框架**：PyTorch / Torchvision
- **图像处理**：Pillow
- **数值计算**：NumPy

> 当前代码默认使用 **CPU** 推理。

---

## 项目结构

```text
imageSearch/
├─ main.py                       # 根入口，兼容原有启动方式
├─ ImageSearch.spec              # PyInstaller 打包配置
├─ requirements.txt              # 依赖清单
├─ resources/
│  └─ assets/                    # 样式、闪屏等静态资源
└─ src/
   ├─ app/
   │  ├─ main.py                 # 应用启动流程（闪屏、模型、索引、主窗口）
   │  └─ main_app.py             # 主界面容器与侧边栏
   ├─ config/
   │  └─ config.py               # 配置加载、默认目录、模型配置
   ├─ core/
   │  ├─ database.py             # SQLite 数据管理
   │  ├─ index_manager.py        # FAISS 内存索引管理
   │  └─ model_manager.py        # DINOv2 模型加载与特征提取
   ├─ ui/
   │  └─ view/
   │     ├─ search_page.py       # 图像检索页面
   │     ├─ db_page.py           # 数据库管理页面
   │     └─ settings_page.py     # 系统设置页面
   └─ utils/
      ├─ feature_utils.py        # 特征归一化等处理
      └─ file_utils.py           # 目录内容复制工具
```

---

## 快速开始

### 1. 创建环境

推荐 Python 3.10：

```bash
conda create -n imageSearch python=3.10
conda activate imageSearch
pip install -r requirements.txt
```

### 2. 启动项目

```bash
python main.py
```

程序启动后会依次完成：
1. 显示闪屏
2. 加载 DINOv2 模型
3. 从数据库重建 FAISS 索引
4. 打开主界面

---

## 使用流程

### 图库入库
1. 打开 **数据库管理** 页面
2. 点击 **新增图片入库**
3. 选择本地图片
4. 程序会自动：
   - 复制图片到统一存储目录
   - 提取特征向量
   - 写入 SQLite 数据库
   - 更新 FAISS 索引

### 图像检索
1. 打开 **图像搜索** 页面
2. 上传一张查询图片
3. 程序自动提取特征并进行相似检索
4. 查看返回结果与匹配度

### 系统设置
可在 **系统设置** 页面修改：
- 模型路径
- 模型类型
- 图片存储目录
- 数据库目录

---

## 默认目录

首次运行时，默认会生成以下目录结构：

```text
data/
├─ models/       # 模型权重
├─ database/     # SQLite 数据库
└─ images/       # 托管图片文件
```

配置写入：

```text
settings.json
```

---

## 模型说明

当前界面中可选模型包括：
- `dinov2_vits14`
- `dinov2_vitb14`
- `dinov2_vitl14`
- `dinov2_vitg14`

但当前代码中**自动下载链接**已配置的模型为：
- `dinov2_vits14`
- `dinov2_vitb14`

如果你要在当前版本中直接切换到 `vitl14` 或 `vitg14`，建议先：
1. 手动准备对应权重文件
2. 放入模型目录
3. 或在 `MODEL_URLS` 中补充下载链接

---

## 注意事项

### 1. 当前索引是“启动时从数据库重建”的
当前实现会把特征向量保存到 SQLite 中，并在程序启动时加载到 FAISS 内存索引；并不是单独持久化一个 `.index` 文件。

### 2. 目录修改更准确地说是“复制迁移”
设置页在修改模型目录、图片目录、数据库目录时，调用的是目录内容复制逻辑，用于将数据复制到新目录并同步配置。

### 3. 匹配度是界面层的展示值
当前搜索结果中的“匹配度”是由距离值通过 `1 / (1 + distance)` 转换得到，更适合作为 UI 展示参考，而不是严格概率。

---

## 打包

项目已提供 PyInstaller 配置：

```bash
pyinstaller ImageSearch.spec
```

---

## 适用场景

- 本地图片素材库检索
- 设计参考图去重与回溯
- 私有图库管理
- 小型图像检索系统原型验证
- AI 图像检索桌面客户端展示项目

---

## 后续可继续增强的方向

- 增加 GPU 推理支持
- 增加文本检索 / 图文混合检索
- 增加拖拽上传与批量查询
- 增加重复图片检测
- 增加索引持久化与增量加载
- 增加标签系统与高级筛选

