compiler main's own build (asterc.aster at 67dac81, cc -O2), git 67dac81650270f04b463fd4df2e4c9905adf8d19 (only scripts/query-profile.ts added)
cc cc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0

## compiler (18 files): query asterc.aster --file=checker.aster --offset=1000

real 0.38 s, user 0.22 s, sys 0.17 s, max RSS 335192 KiB (median of 5)

```text
Flat profile:

Each sample counts as 0.01 seconds.
  %   cumulative   self              self     total           
 time   seconds   seconds    calls  ms/call  ms/call  name    
 45.00      0.09     0.09     5955     0.02     0.03  aster_fn_sha256_block
 30.00      0.15     0.06 37977553     0.00     0.00  aster_rt_array_at
 10.00      0.17     0.02  3430080     0.00     0.00  aster_fn_rotr32
  5.00      0.18     0.01   208903     0.00     0.00  map_find
  5.00      0.19     0.01   208653     0.00     0.00  aster_rt_map_slot
  5.00      0.20     0.01        1    10.00    12.57  aster_fn_build_query
  0.00      0.20     0.00  3917102     0.00     0.00  aster_rt_byte_at
  0.00      0.20     0.00  2935685     0.00     0.00  aster_rt_str_eq
  0.00      0.20     0.00  1925674     0.00     0.00  aster_rt_len
  0.00      0.20     0.00  1274425     0.00     0.00  aster_rt_concat
  0.00      0.20     0.00   886580     0.00     0.00  aster_rt_alloc
  0.00      0.20     0.00   597732     0.00     0.00  aster_rt_substring
  0.00      0.20     0.00   416253     0.00     0.00  aster_rt_array_push_slot
  0.00      0.20     0.00   381120     0.00     0.00  aster_fn_padded_byte
  0.00      0.20     0.00   256316     0.00     0.00  aster_fn_json_str
  0.00      0.20     0.00   152377     0.00     0.00  aster_rt_array_new
  0.00      0.20     0.00   121756     0.00     0.00  aster_rt_int_to_string
  0.00      0.20     0.00   112086     0.00     0.00  aster_fn_json_field_value
  0.00      0.20     0.00    89724     0.00     0.00  aster_fn_level_ops
  0.00      0.20     0.00    74596     0.00     0.00  aster_fn_is_punct
```

total 306798154 bytes requested
| Bytes | Calls | Kind | Caller |
| ---: | ---: | --- | --- |
| 158338748 | 42251 | concat | aster_fn_string_literal_value |
| 37413452 | 97442 | concat | aster_fn_json_join |
| 15746276 | 97442 | concat | aster_fn_json_join |
| 11252224 | 9252 | alloc | map_rebuild |
| 7028170 | 24514 | concat | aster_fn_json_object |
| 7003656 | 24514 | concat | aster_fn_json_object |
| 6886769 | 116887 | concat | aster_fn_json_kv |
| 5598557 | 826 | concat | aster_fn_string_literal_value |
| 4876096 | 152378 | alloc | aster_rt_array_new |
| 4862432 | 116652 | alloc | aster_rt_array_new |
| 2494152 | 103923 | alloc | aster_fn_json_field_value |
| 2346696 | 26667 | alloc | aster_fn_fact |
| 2293664 | 71677 | alloc | aster_fn_push_token |
| 2291616 | 71613 | alloc | aster_fn_new_parser_at |
| 2264312 | 256316 | concat | aster_fn_json_str |

## generated (467 KiB): query large.aster --file=large.aster --offset=477824

real 0.79 s, user 0.44 s, sys 0.33 s, max RSS 673452 KiB (median of 5)

```text
Flat profile:

Each sample counts as 0.01 seconds.
  %   cumulative   self              self     total           
 time   seconds   seconds    calls  ms/call  ms/call  name    
 39.39      0.13     0.13     7467     0.02     0.03  aster_fn_sha256_block
 12.12      0.17     0.04 50200123     0.00     0.00  aster_rt_array_at
 12.12      0.21     0.04  4300992     0.00     0.00  aster_fn_rotr32
  9.09      0.24     0.03  5220717     0.00     0.00  aster_rt_concat
  6.06      0.26     0.02   530571     0.00     0.00  aster_rt_map_slot
  3.03      0.27     0.01 11113908     0.00     0.00  aster_rt_byte_at
  3.03      0.28     0.01  2131815     0.00     0.00  aster_rt_substring
  3.03      0.29     0.01    45005     0.00     0.00  aster_fn_check_expr_node
  3.03      0.30     0.01    10002     0.00     0.00  aster_fn_site_order
  3.03      0.31     0.01     5001     0.00     0.01  aster_fn_check_function
  3.03      0.32     0.01     5001     0.00     0.00  aster_fn_collect_signature
  3.03      0.33     0.01        1    10.00    16.64  aster_fn_build_query
  0.00      0.33     0.00  6548179     0.00     0.00  aster_rt_str_eq
  0.00      0.33     0.00  5821035     0.00     0.00  aster_rt_len
  0.00      0.33     0.00  2446444     0.00     0.00  aster_rt_alloc
  0.00      0.33     0.00  1161473     0.00     0.00  aster_fn_json_str
  0.00      0.33     0.00   921475     0.00     0.00  aster_rt_array_push_slot
  0.00      0.33     0.00   530696     0.00     0.00  map_find
  0.00      0.33     0.00   525903     0.00     0.00  aster_fn_json_field_value
  0.00      0.33     0.00   477888     0.00     0.00  aster_fn_padded_byte
```

total 559872333 bytes requested
| Bytes | Calls | Kind | Caller |
| ---: | ---: | --- | --- |
| 186805373 | 430368 | concat | aster_fn_json_join |
| 78343498 | 430368 | concat | aster_fn_json_join |
| 31562483 | 115088 | concat | aster_fn_json_object |
| 31447395 | 115088 | concat | aster_fn_json_object |
| 31124288 | 30181 | alloc | map_rebuild |
| 30921985 | 525410 | concat | aster_fn_json_kv |
| 11659992 | 485833 | alloc | aster_fn_json_field_value |
| 11174400 | 220163 | alloc | aster_rt_array_new |
| 10176750 | 1161473 | concat | aster_fn_json_str |
| 9769024 | 305282 | alloc | aster_rt_array_new |
| 9015277 | 1161473 | concat | aster_fn_json_str |
| 8120034 | 5016 | concat | aster_fn_json_array |
| 8115018 | 5016 | concat | aster_fn_json_array |
| 6001660 | 300083 | itos | aster_fn_json_int |
| 5442816 | 170088 | alloc | aster_fn_push_token |

