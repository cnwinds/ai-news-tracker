"""
基于正则表达式的邮件解析器
用于解析TLDR等新闻邮件，替代大模型分析
"""
import re
import logging
from typing import List, Dict, Any, Optional, Tuple
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


class EmailRegexParser:
    """
    基于正则的邮件解析器
    使用可配置的正则表达式模式来提取文章
    """

    def __init__(self, config: Dict[str, Any]):
        """
        初始化解析器

        Args:
            config: 解析配置，包含正则表达式模式和提取规则
        """
        self.config = config
        self.rules = config.get("regex_rules", {})

    def parse(self, content: str, content_type: str = "plain") -> List[Dict[str, Any]]:
        """
        解析邮件内容，提取文章列表

        Args:
            content: 邮件内容（HTML或纯文本）
            content_type: 内容类型 ("html" 或 "plain")

        Returns:
            文章列表，每篇文章包含 title, url, content 等字段
        """
        if content_type == "html":
            return self._parse_html(content)
        else:
            return self._parse_plain_text(content)

    def _parse_plain_text(self, content: str) -> List[Dict[str, Any]]:
        """解析纯文本格式的邮件"""
        articles = []

        # 步骤1: 提取链接映射（从 Links: 部分）
        link_map = self._extract_links_plain(content)
        logger.info(f"📎 提取到 {len(link_map)} 个链接映射")

        # 步骤2: 分割文章块
        article_blocks = self._split_article_blocks_plain(content)
        logger.info(f"📦 找到 {len(article_blocks)} 个文章块")

        # 步骤3: 从每个文章块中提取文章信息
        for block in article_blocks:
            article = self._extract_article_from_block(block, link_map)
            if article:
                articles.append(article)

        logger.info(f"✅ 成功解析 {len(articles)} 篇文章")
        return articles

    def _parse_html(self, content: str) -> List[Dict[str, Any]]:
        """
        解析HTML格式的邮件

        策略：
        1. 直接从HTML中提取所有文章（标题 + URL + 摘要）
        2. 不依赖纯文本中的引用标记
        """
        articles = []

        try:
            soup = BeautifulSoup(content, 'html.parser')

            # 移除script和style标签
            for script in soup(["script", "style"]):
                script.decompose()

            # 步骤1: 从HTML中直接提取文章
            articles = self._extract_articles_from_html(soup)
            logger.info(f"🔗 从HTML提取到 {len(articles)} 篇文章")

            if not articles:
                logger.warning("⚠️  HTML中未找到文章，回退到纯文本解析")
                text = soup.get_text()
                return self._parse_plain_text(text)

        except Exception as e:
            logger.error(f"❌ HTML解析失败: {e}")
            # 回退到纯文本解析
            soup = BeautifulSoup(content, 'html.parser')
            text = soup.get_text()
            return self._parse_plain_text(text)

        return articles

    def _extract_articles_from_html(self, soup: BeautifulSoup) -> List[Dict[str, Any]]:
        """
        直接从HTML中提取文章

        TLDR HTML结构：
        - 文章标题在<span>或<a>标签中
        - 标题包含 "minute read" 或 "(sponsor)" 等标识
        - URL在相邻的<a>标签中
        - 文章内容在标题后的<p>或<div>标签中

        Returns:
            文章列表
        """
        articles = []

        try:
            # 找到所有<a>标签
            for a_tag in soup.find_all('a', href=True):
                href = a_tag.get('href')

                # 提取真实URL
                real_url = self._extract_real_url(href)
                if not real_url:
                    continue

                # 获取链接文本
                link_text = a_tag.get_text(strip=True)

                # 检查是否是文章链接
                if not self._is_article_link(link_text, real_url):
                    continue

                # 清理标题
                clean_title = self._clean_html_title(link_text)
                if not clean_title:
                    continue

                # 查找文章内容
                content = self._extract_article_content_from_html(a_tag)

                if not content:
                    logger.debug(f"⚠️  未找到内容: {clean_title[:50]}")
                    continue

                articles.append({
                    "title": clean_title,
                    "url": real_url,
                    "content": content,
                    "metadata": {
                        "ref_id": None,
                        "original_title_line": link_text
                    }
                })

                logger.debug(f"✅ 提取文章: {clean_title[:50]}...")

        except Exception as e:
            logger.error(f"❌ 提取HTML文章失败: {e}")

        return articles

    def _extract_article_content_from_html(self, a_tag) -> str:
        """
        从HTML中提取文章内容

        TLDR HTML结构：
        <span>
            <a href="..."><strong>标题 (minute read)</strong></a>
            <br><br>
            <span>文章内容...</span>
        </span>

        策略：
        1. 找到<a>标签的父级<span>
        2. 在父级中查找除<a>以外的其他<span>元素
        3. 提取文本内容
        """
        content_parts = []

        try:
            # 找到<a>标签的父级<span>元素
            parent_span = a_tag.find_parent('span')
            if not parent_span:
                # 如果没有父级<span>，尝试查找父级<td>或<div>
                parent = a_tag.find_parent(['td', 'div', 'p'])
                if not parent:
                    return ""
            else:
                parent = parent_span

            # 在父元素中查找所有子元素
            for child in parent.descendants:
                if child.name == 'span' and child != a_tag.parent:
                    # 获取文本
                    text = child.get_text(strip=True)

                    # 排除包含"minute read"的span（这些是标题span）
                    if 'minute read' in text.lower():
                        continue

                    # 排除包含<a>标签的span（即标题所在的span）
                    if child.find('a'):
                        continue

                    # 过滤掉太短或包含广告的文本
                    if text and len(text) > 20:
                        if not any(skip in text.lower() for skip in ['sponsored by', 'try now for free', 'apply here']):
                            content_parts.append(text)

            # 如果在span中没找到，尝试查找父元素的所有文本节点
            if not content_parts:
                # 获取父元素的完整文本
                full_text = parent.get_text(strip=True)

                # 移除标题部分（即<a>标签的文本）
                title_text = a_tag.get_text(strip=True)
                if title_text in full_text:
                    content_text = full_text.replace(title_text, '', 1).strip()
                else:
                    content_text = full_text

                # 清理内容
                if content_text and len(content_text) > 20:
                    content_parts.append(content_text)

            # 合并内容
            content = ' '.join(content_parts)

            # 清理内容（移除多余空白、特殊字符等）
            content = self._clean_content(content)

            # 移除内容开头的 "(X minute read)" 等阅读时间标识
            content = re.sub(r'^\(\d+\s*minute\s+read\)\s*', '', content, flags=re.IGNORECASE)

            # 再次移除标题（防止标题重复出现在内容中）
            title_text = a_tag.get_text(strip=True)
            clean_title = self._clean_html_title(title_text)
            if clean_title.lower() in content.lower():
                # 移除标题（不区分大小写）
                pattern = re.compile(re.escape(clean_title), re.IGNORECASE)
                content = pattern.sub('', content).strip()

            # 清理开头的标点符号和多余空格
            content = content.lstrip('.,;:-)').strip()

            return content

        except Exception as e:
            logger.debug(f"⚠️  提取内容失败: {e}")
            return ""

    def _extract_real_url(self, tracking_url: str) -> Optional[str]:
        """
        从tldr tracking链接中提取真实URL

        tldr的tracking格式：
        https://tracking.tldrnewsletter.com/CL0/<encoded_url>/...

        Args:
            tracking_url: tracking链接

        Returns:
            真实URL，如果不是tracking链接则返回原URL
        """
        try:
            # 检查是否是tldr tracking链接
            if 'tracking.tldrnewsletter.com' in tracking_url:
                # 使用urllib解析
                from urllib.parse import unquote

                # 从路径中提取编码的URL部分
                # 格式: /CL0/encoded_url/...
                match = re.search(r'/CL0/([^/]+)', tracking_url)
                if match:
                    encoded_url = match.group(1)
                    # 解码URL（%2F -> / 等）
                    decoded = unquote(encoded_url)
                    # 添加https://前缀（如果需要）
                    if not decoded.startswith('http'):
                        decoded = 'https://' + decoded
                    return decoded

            # 如果不是tracking链接，直接返回
            if tracking_url.startswith('http'):
                return tracking_url

        except Exception as e:
            logger.debug(f"⚠️  URL解析失败: {e}")

        return None

    def _is_article_link(self, text: str, url: str) -> bool:
        """
        判断一个链接是否是文章链接

        Args:
            text: 链接文本
            url: 链接URL

        Returns:
            是否是文章链接
        """
        if not text or not url:
            return False

        # 必须排除的链接
        skip_patterns = [
            'sign up', 'advertise', 'view online', 'unsubscribe',
            'manage your', 'referral', 'jobs@', 'apply here',
            'create your own', 'track your'
        ]

        text_lower = text.lower()
        for pattern in skip_patterns:
            if pattern in text_lower:
                return False

        # 文章链接特征：
        # 1. 包含 "minute read"
        # 2. 或包含 "(sponsor)"
        # 3. 或包含 "(github repo)"
        # 4. 且URL是外部链接（不是tldr内部链接）
        if 'minute read' in text_lower:
            return True

        if '(sponsor)' in text_lower or '(github repo)' in text_lower:
            return True

        # 检查URL是否是外部文章链接
        # 排除tldr内部链接
        if 'tldr.tech' in url and 'manage' not in url:
            return False

        # 如果链接文本看起来像标题（大部分大写，足够长）
        if len(text) > 15:
            upper_count = sum(1 for c in text if c.isupper())
            total_count = sum(1 for c in text if c.isalpha())
            if total_count > 0 and upper_count / total_count > 0.6:
                return True

        return False

    def _clean_html_title(self, title: str) -> str:
        """
        清理HTML中的文章标题

        Args:
            title: 原始标题

        Returns:
            清理后的标题
        """
        # 移除 "(X minute read)"
        title = re.sub(r'\s*\(\d+\s*minute\s+read\)', '', title, flags=re.IGNORECASE)

        # 移除 "(sponsor)"
        title = re.sub(r'\s*\(sponsor\)', '', title, flags=re.IGNORECASE)

        # 移除 "(github repo)"
        title = re.sub(r'\s*\(github\s+repo\)', '', title, flags=re.IGNORECASE)

        return title.strip()

    def _extract_links_plain(self, content: str) -> Dict[str, str]:
        """
        从纯文本中提取链接映射

        Links: 部分格式：
        Links:
        ------
        [1] https://example.com/article1
        [2] https://example.com/article2

        Args:
            content: 邮件纯文本内容

        Returns:
            {引用编号: URL} 的映射字典，如 {"1": "https://..."}
        """
        link_map = {}

        # 查找 Links: 部分
        links_section_pattern = self.rules.get(
            "links_section_pattern",
            r"Links:\n-+\n+(.*?)(?=\n\n\n|\nWant to|\. If you have|\Z)"
        )

        match = re.search(links_section_pattern, content, re.DOTALL)
        if not match:
            logger.warning("⚠️  未找到 Links: 部分")
            return link_map

        links_section = match.group(1)

        # 提取每个链接
        # 格式: [数字] URL
        link_pattern = self.rules.get(
            "link_pattern",
            r"\[(\d+)\]\s+(https?://[^\s\]]+)"
        )

        for match in re.finditer(link_pattern, links_section):
            ref_id = match.group(1)
            url = match.group(2)
            link_map[ref_id] = url

        return link_map

    def _split_article_blocks_plain(self, content: str) -> List[str]:
        """
        将纯文本内容分割成文章块

        策略：
        1. 先移除头部和尾部无关内容
        2. 根据文章标题模式分割

        Args:
            content: 邮件纯文本内容

        Returns:
            文章块的列表
        """
        # 步骤1: 移除头部无关内容
        header_patterns = self.rules.get("remove_headers", [])
        for pattern in header_patterns:
            content = re.sub(pattern, "", content, flags=re.DOTALL)

        # 步骤2: 移除尾部无关内容（广告、推荐等）
        footer_patterns = self.rules.get("remove_footers", [])
        for pattern in footer_patterns:
            content = re.sub(pattern, "", content, flags=re.DOTALL)

        # 步骤3: 根据文章标题模式分割内容
        # TLDR的文章标题格式：全大写 + (X MINUTE READ) + [数字]
        title_pattern = self.rules.get(
            "article_title_pattern",
            r"^[A-Z][A-Z\s&\'\-]+(\(\d+\+?\s+MINUTE\s+READ\))\s+\[\d+\]"
        )

        # 找到所有文章标题的位置
        title_positions = []
        for match in re.finditer(title_pattern, content, re.MULTILINE):
            title_positions.append(match.start())

        if not title_positions:
            logger.warning("⚠️  未找到任何文章标题")
            return []

        # 步骤4: 根据标题位置分割文章块
        article_blocks = []
        for i, pos in enumerate(title_positions):
            # 当前文章的起始位置
            start = pos

            # 下一篇文章的起始位置（如果是最后一篇，则到内容结尾）
            end = title_positions[i + 1] if i + 1 < len(title_positions) else len(content)

            # 提取文章块
            block = content[start:end].strip()
            article_blocks.append(block)

        return article_blocks

    def _extract_article_from_block(
        self,
        block: str,
        link_map: Dict[str, str]
    ) -> Optional[Dict[str, Any]]:
        """
        从文章块中提取文章信息

        Args:
            block: 文章块文本
            link_map: 链接映射字典

        Returns:
            文章字典，包含 title, url, content 等
        """
        try:
            # 步骤1: 提取标题
            title_pattern = self.rules.get(
                "article_title_pattern",
                r"^[A-Z][A-Z\s&\'\-]+(\(\d+\+?\s+MINUTE\s+READ\))\s+\[\d+\]"
            )

            title_match = re.search(title_pattern, block, re.MULTILINE)
            if not title_match:
                logger.warning(f"⚠️  无法提取标题: {block[:50]}...")
                return None

            title_line = title_match.group(0).strip()

            # 提取引用编号
            ref_match = re.search(r"\[(\d+)\]$", title_line)
            ref_id = ref_match.group(1) if ref_match else None

            # 获取真实URL
            url = link_map.get(ref_id, "") if ref_id else ""

            # 清理标题：移除 (X MINUTE READ) 和 [数字]
            clean_title = title_line
            clean_title = re.sub(r"\(\d+\+?\s+MINUTE\s+READ\)", "", clean_title, flags=re.IGNORECASE)
            clean_title = re.sub(r"\s*\[\d+\]$", "", clean_title)
            clean_title = clean_title.strip()

            # 步骤2: 提取内容（标题之后的所有文本）
            # 找到标题行之后的内容
            lines = block.split('\n')
            content_lines = []

            # 跳过标题行，收集内容
            skip_title = True
            for line in lines:
                if skip_title:
                    # 检查是否是标题行
                    if re.match(title_pattern, line.strip()):
                        skip_title = False
                        continue
                else:
                    # 收集内容行
                    stripped = line.strip()
                    if stripped:
                        content_lines.append(stripped)

            # 合并内容段落
            content = ' '.join(content_lines)

            # 步骤3: 清理内容
            content = self._clean_content(content)

            if not content:
                logger.warning(f"⚠️  文章内容为空: {clean_title}")
                return None

            return {
                "title": clean_title,
                "url": url,
                "content": content,
                "metadata": {
                    "ref_id": ref_id,
                    "original_title_line": title_line
                }
            }

        except Exception as e:
            logger.error(f"❌ 提取文章失败: {e}")
            return None

    def _clean_content(self, content: str) -> str:
        """
        清理文章内容

        Args:
            content: 原始内容

        Returns:
            清理后的内容
        """
        # 移除多余空白
        content = re.sub(r'\s+', ' ', content)

        # 移除特定模式（如 "" 等特殊空白字符）
        content = re.sub(r'[\u200c\u200e\u200f\u00a0]+', ' ', content)

        # 移除广告标识
        ad_patterns = self.rules.get("ad_patterns", [])
        for pattern in ad_patterns:
            content = re.sub(pattern, "", content, flags=re.IGNORECASE)

        return content.strip()

    def _preprocess_lines(self, lines: List[str]) -> List[str]:
        """
        预处理行，合并跨行的标题

        某些标题可能跨多行，如：
        CURSOR CEO BUILT A BROWSER USING AI, BUT DOES IT REALLY WORK? (5
        MINUTE READ) [15]

        应该合并为：
        CURSOR CEO BUILT A BROWSER USING AI, BUT DOES IT REALLY WORK? (5 MINUTE READ) [15]
        """
        processed = []
        i = 0

        while i < len(lines):
            current_line = lines[i].strip()

            # 如果当前行不包含 [数字] 但看起来像标题的一部分（全大写）
            # 且下一行包含 [数字]，则合并
            if (not re.search(r'\[\d+\]$', current_line) and
                current_line.isupper() and
                len(current_line) > 5 and
                i + 1 < len(lines)):

                next_line = lines[i + 1].strip()

                # 如果下一行包含 [数字] 引用，合并两行
                if re.search(r'\[\d+\]$', next_line):
                    merged = f"{current_line} {next_line}"
                    processed.append(merged)
                    i += 2
                    continue

            # 否则直接添加当前行
            processed.append(current_line)
            i += 1

        return processed

    def _is_title_line(self, line: str) -> bool:
        """
        判断一行是否是文章标题

        标题特征：
        1. 包含 [数字] 引用
        2. 不太短（>10字符）
        3. 大部分是大写字母
        4. 不是导航、分类等
        """
        # 必须包含 [数字] 引用
        if not re.search(r'\[\d+\]$', line):
            return False

        # 移除引用标记
        title_part = re.sub(r'\s*\[\d+\]$', '', line).strip()

        # 长度检查
        if len(title_part) < 10:
            return False

        # 过滤导航和分类
        skip_patterns = [
            r'^Sign Up',
            r'^Advertise',
            r'^View Online',
            r'^TLDR DEV',
            r'^ARTICLES&TUTORIALS$',
            r'^OPINIONS&ADVICE$',
            r'^LAUNCHES&TOOLS$',
            r'^MISCELLANEOUS$',
            r'^QUICK LINKS$',
        ]

        for pattern in skip_patterns:
            if re.match(pattern, title_part, re.IGNORECASE):
                return False

        # 检查大写字母比例（至少50%是大写）
        upper_count = sum(1 for c in title_part if c.isupper())
        total_count = sum(1 for c in title_part if c.isalpha())

        if total_count > 0 and upper_count / total_count < 0.5:
            return False

        return True

    def _count_article_lines(self, lines: List[str], title_index: int) -> int:
        """计算文章占用的行数（用于跳过已处理的行）"""
        count = 1  # 标题行
        i = title_index + 1

        while i < len(lines):
            line = lines[i].strip()

            if not line:
                if count > 1:  # 已经收集了内容
                    break
                i += 1
                continue

            if self._is_title_line(line):
                break

            count += 1
            i += 1

        return count


class TLDREmailParser(EmailRegexParser):
    """
    TLDR邮件专用解析器
    预配置了TLDR邮件的正则规则
    """

    def __init__(self):
        # TLDR邮件的预配置规则
        config = {
            "regex_rules": {
                # Links: 部分的正则模式
                "links_section_pattern": r"Links:\n-+\n+(.*?)(?=\n\n\n|\nLove TLDR|\nWant to advertise|\nWant to work|\nIf you have|\Z)",

                # 单个链接的正则模式
                "link_pattern": r"\[(\d+)\]\s+(https?://[^\s\]]+)",

                # 文章标题的正则模式 - 更宽松的模式
                "article_title_pattern": r"^\s+[A-Z][A-Z0-9\s&\'\-?:,/()+!?]+\s*\[\d+\]\s*",

                # 需要从头部移除的内容
                "remove_headers": [
                    r"^.*?Sign Up.*?\n",  # 导航行
                    r"^.*?Advertise.*?\n",
                    r"^.*?View Online.*?\n",
                    r"^\s*TLDR\s*\n",
                    r"^\s*TLDR DEV \d{4}-\d{2}-\d{2}\s*\n",
                    r"^\s*[🧑‍💻🧠🚀🎁⚡]+\s*\n",
                    r"^\s*[A-Z][A-Z\s&\'\-]+\s*\n",  # 分类标题（如 "ARTICLES & TUTORIALS"）
                ],

                # 需要从尾部移除的内容
                "remove_footers": [
                    r"\n\nLove TLDR.*?(?=\Z)",  # 推荐部分
                    r"\n\nWant to advertise.*?(?=\Z)",
                    r"\n\nWant to work.*?(?=\Z)",
                    r"\n\nIf you have any comments.*?(?=\Z)",
                    r"\n\nThanks for reading.*?(?=\Z)",
                    r"\n\nManage your subscriptions.*?(?=\Z)",
                    r"\n\nLinks:\n-+.*?(?=\Z)",  # Links部分（用于分割，不用于提取）
                ],

                # 广告模式
                "ad_patterns": [
                    r"\(SPONSOR\)",
                    r"Sponsored by",
                ]
            }
        }

        super().__init__(config)

    def _parse_plain_text(self, content: str) -> List[Dict[str, Any]]:
        """重写纯文本解析方法，使用更准确的策略"""
        articles = []

        # 步骤1: 提取链接映射
        link_map = self._extract_links_plain(content)
        logger.info(f"📎 提取到 {len(link_map)} 个链接")

        # 步骤2: 使用更精确的方法提取文章
        # 先处理跨行标题：将连续的大写行合并
        lines = content.split('\n')
        processed_lines = self._preprocess_lines(lines)

        i = 0
        while i < len(processed_lines):
            line = processed_lines[i].strip()

            # 检查是否是标题行
            # 标题特征：包含 [数字] 引用，且大多数文字是大写
            if self._is_title_line(line):
                # 提取文章（使用基类的_extract_article_from_block方法）
                # 重新构建文章块
                title_match = re.search(r'^\s+[A-Z][A-Z0-9\s&\'\-?:,/()+!?]+\s*\[\d+\]\s*', line)
                if title_match:
                    # 收集文章内容
                    content_lines = []
                    j = i + 1
                    while j < len(processed_lines):
                        next_line = processed_lines[j].strip()
                        if not next_line or self._is_title_line(next_line):
                            break
                        content_lines.append(next_line)
                        j += 1

                    # 构建文章块
                    block = line + '\n' + '\n'.join(content_lines)
                    article = self._extract_article_from_block(block, link_map)
                    if article:
                        articles.append(article)
                        i = j
                        continue

            i += 1

        logger.info(f"✅ 成功解析 {len(articles)} 篇文章")
        return articles


def get_parser(source_type: str, config: Optional[Dict[str, Any]] = None) -> EmailRegexParser:
    """
    工厂函数：根据源类型返回相应的解析器

    Args:
        source_type: 源类型（如 "tldr", "generic"）
        config: 自定义配置（可选）

    Returns:
        邮件解析器实例
    """
    if source_type == "tldr":
        return TLDREmailParser()
    elif config:
        return EmailRegexParser(config)
    else:
        raise ValueError(f"不支持的源类型: {source_type}，或缺少配置")
