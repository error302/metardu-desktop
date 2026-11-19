(module
  (memory (export "memory") 2 1024)
  (data (i32.const 64) "{\"ok\":true}")

  (func (export "metardu_plugin_abi_version") (result i32)
    (i32.const 1))

  ;; The demo accepts only small inputs that fit in its initial two pages.
  (func (export "metardu_plugin_alloc") (param i32) (result i32)
    (i32.const 1024))

  ;; ABI v1 packs output pointer 64 and byte length 11 into an i64.
  (func (export "metardu_plugin_run") (param i32 i32) (result i64)
    (i64.const 274877906955)))
