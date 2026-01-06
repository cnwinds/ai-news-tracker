"""
认证相关 API 端点
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.core.dependencies import get_database
from backend.app.core.settings import settings
from backend.app.db.repositories import AppSettingsRepository
from sqlalchemy.orm import Session
import logging

router = APIRouter()
security = HTTPBearer()

# 密码加密上下文
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT配置
SECRET_KEY = settings.DATABASE_URL  # 使用数据库URL作为密钥（实际项目中应使用更安全的密钥）
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7天


class LoginRequest(BaseModel):
    """登录请求"""
    username: str
    password: str


class LoginResponse(BaseModel):
    """登录响应"""
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    """Token数据"""
    username: Optional[str] = None


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码
    
    bcrypt 限制密码长度不能超过 72 字节，如果超过则截断
    """
    # bcrypt 限制密码不能超过 72 字节
    # 将密码编码为 UTF-8 字节，然后截断到 72 字节
    password_bytes = plain_password.encode('utf-8')
    if len(password_bytes) > 72:
        password_bytes = password_bytes[:72]
        plain_password = password_bytes.decode('utf-8', errors='ignore')
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """获取密码哈希
    
    bcrypt 限制密码长度不能超过 72 字节，如果超过则截断
    """
    # bcrypt 限制密码不能超过 72 字节
    # 将密码编码为 UTF-8 字节，然后截断到 72 字节
    password_bytes = password.encode('utf-8')
    if len(password_bytes) > 72:
        password_bytes = password_bytes[:72]
        password = password_bytes.decode('utf-8', errors='ignore')
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """创建访问令牌"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_token_string(token: str) -> TokenData:
    """验证token字符串"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="无效的认证凭据",
                headers={"WWW-Authenticate": "Bearer"},
            )
        token_data = TokenData(username=username)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的认证凭据",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token_data


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> TokenData:
    """验证token（用于依赖注入）"""
    return verify_token_string(credentials.credentials)


# 默认管理员账号（首次使用时需要设置）
# 实际项目中应该从数据库或环境变量读取
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "admin123"  # 首次登录后应修改

# AppSettings中的键名
ADMIN_USERNAME_KEY = "admin_username"
ADMIN_PASSWORD_HASH_KEY = "admin_password_hash"


def get_stored_username(db: Session) -> str:
    """获取存储的用户名，如果不存在则返回默认值"""
    username = AppSettingsRepository.get_setting(db, ADMIN_USERNAME_KEY, DEFAULT_ADMIN_USERNAME)
    if not username:
        # 如果不存在，初始化默认用户名
        AppSettingsRepository.set_setting(
            db, ADMIN_USERNAME_KEY, DEFAULT_ADMIN_USERNAME, "string", "管理员用户名"
        )
        return DEFAULT_ADMIN_USERNAME
    return username


def get_stored_password_hash(db: Session) -> Optional[str]:
    """获取存储的密码哈希，如果不存在则初始化默认密码"""
    password_hash = AppSettingsRepository.get_setting(db, ADMIN_PASSWORD_HASH_KEY, None)
    if not password_hash:
        # 如果不存在，初始化默认密码的哈希
        try:
            default_hash = get_password_hash(DEFAULT_ADMIN_PASSWORD)
            AppSettingsRepository.set_setting(
                db, ADMIN_PASSWORD_HASH_KEY, default_hash, "string", "管理员密码哈希"
            )
            return default_hash
        except (ValueError, Exception) as e:
            # 如果密码哈希生成失败，记录日志
            logger = logging.getLogger(__name__)
            logger.error(f"初始化默认密码哈希失败: {e}")
            # 返回 None，让调用者处理
            return None
    return password_hash


@router.post("/login", response_model=LoginResponse)
async def login(login_data: LoginRequest, db: Session = Depends(get_database)):
    """用户登录"""
    # 从数据库获取用户名和密码哈希
    stored_username = get_stored_username(db)
    stored_password_hash = get_stored_password_hash(db)
    
    # 检查密码哈希是否有效
    if not stored_password_hash:
        logger = logging.getLogger(__name__)
        logger.error("无法获取存储的密码哈希")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="系统配置错误，请联系管理员",
        )
    
    # 验证用户名
    if login_data.username != stored_username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # 验证密码
    if not verify_password(login_data.password, stored_password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # 登录成功，生成token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": login_data.username}, expires_delta=access_token_expires
    )
    return LoginResponse(access_token=access_token, token_type="bearer")


@router.post("/logout")
async def logout():
    """用户登出（客户端删除token即可）"""
    return {"message": "登出成功"}


@router.get("/me")
async def get_current_user(token_data: TokenData = Depends(verify_token)):
    """获取当前用户信息"""
    return {"username": token_data.username}


@router.get("/verify")
async def verify_token_endpoint(token_data: TokenData = Depends(verify_token)):
    """验证token是否有效"""
    return {"valid": True, "username": token_data.username}


class ChangePasswordRequest(BaseModel):
    """修改密码请求"""
    old_password: str
    new_password: str


@router.post("/change-password")
async def change_password(
    password_data: ChangePasswordRequest,
    token_data: TokenData = Depends(verify_token),
    db: Session = Depends(get_database)
):
    """修改密码"""
    # 获取当前存储的密码哈希
    stored_password_hash = get_stored_password_hash(db)
    
    # 检查密码哈希是否有效
    if not stored_password_hash:
        logger = logging.getLogger(__name__)
        logger.error("无法获取存储的密码哈希")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="无法获取存储的密码哈希，请检查系统配置",
        )
    
    # 验证旧密码
    if not verify_password(password_data.old_password, stored_password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="旧密码错误",
        )
    
    # 验证新密码长度（至少6位，最多72字节）
    if len(password_data.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="新密码长度至少为6位",
        )
    
    # 检查密码是否超过72字节（bcrypt限制）
    password_bytes = password_data.new_password.encode('utf-8')
    if len(password_bytes) > 72:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="密码长度不能超过72字节（约54个中文字符或72个英文字符）",
        )
    
    # 生成新密码哈希并保存
    try:
        new_password_hash = get_password_hash(password_data.new_password)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"密码哈希生成失败: {str(e)}",
        )
    AppSettingsRepository.set_setting(
        db, ADMIN_PASSWORD_HASH_KEY, new_password_hash, "string", "管理员密码哈希"
    )
    
    return {"message": "密码修改成功"}
