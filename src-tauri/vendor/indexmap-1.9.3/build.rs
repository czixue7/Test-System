fn main() {
    // 静态声明 has_std（默认 std feature 开启）；移除 autocfg 探测以规避构建环境问题
    println!("cargo:rustc-cfg=has_std");
}
