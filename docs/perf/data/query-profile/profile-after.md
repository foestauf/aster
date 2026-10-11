compiler build/asterc, git 67dac81650270f04b463fd4df2e4c9905adf8d19 (this branch, uncommitted)
cc cc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0

## compiler (18 files): query asterc.aster --file=checker.aster --offset=1000

real 0.27 s, user 0.21 s, sys 0.06 s, max RSS 119868 KiB (median of 5)

```text
Flat profile:

Each sample counts as 0.01 seconds.
  %   cumulative   self              self     total           
 time   seconds   seconds    calls  ms/call  ms/call  name    
 60.00      0.12     0.12     6029     0.02     0.03  aster_fn_sha256_block
 20.00      0.16     0.04 38427461     0.00     0.00  aster_rt_array_at
 10.00      0.18     0.02  3472704     0.00     0.00  aster_fn_rotr32
  5.00      0.19     0.01    12387     0.00     0.00  aster_fn_json_range
  5.00      0.20     0.01     4237     0.00     0.00  aster_fn_check_stmt
  0.00      0.20     0.00  3945495     0.00     0.00  aster_rt_byte_at
  0.00      0.20     0.00  2936686     0.00     0.00  aster_rt_str_eq
  0.00      0.20     0.00  1939940     0.00     0.00  aster_rt_len
  0.00      0.20     0.00  1279146     0.00     0.00  aster_rt_concat
  0.00      0.20     0.00   886864     0.00     0.00  aster_rt_alloc
  0.00      0.20     0.00   602280     0.00     0.00  aster_rt_substring
  0.00      0.20     0.00   416350     0.00     0.00  aster_rt_array_push_slot
  0.00      0.20     0.00   385856     0.00     0.00  aster_fn_padded_byte
  0.00      0.20     0.00   256356     0.00     0.00  aster_fn_json_str
  0.00      0.20     0.00   208980     0.00     0.00  map_find
  0.00      0.20     0.00   208728     0.00     0.00  aster_rt_map_slot
  0.00      0.20     0.00   152436     0.00     0.00  aster_rt_array_new
  0.00      0.20     0.00   121771     0.00     0.00  aster_rt_int_to_string
  0.00      0.20     0.00   112107     0.00     0.00  aster_fn_json_field_value
  0.00      0.20     0.00    89766     0.00     0.00  aster_fn_level_ops
```

total 391274066 bytes requested
| Bytes | Calls | Kind | Caller |
| ---: | ---: | --- | --- |
| 240503837 | 46679 | concat | aster_fn_string_literal_value |
| 37418114 | 97452 | concat | aster_fn_json_join |
| 15736502 | 97452 | concat | aster_fn_json_join |
| 11254464 | 9255 | alloc | map_rebuild |
| 7894366 | 930 | concat | aster_fn_string_literal_value |
| 7028973 | 24519 | concat | aster_fn_json_object |
| 7004454 | 24519 | concat | aster_fn_json_object |
| 6887553 | 116901 | concat | aster_fn_json_kv |
| 4877984 | 152437 | alloc | aster_rt_array_new |
| 4864384 | 116702 | alloc | aster_rt_array_new |
| 2494608 | 103942 | alloc | aster_fn_json_field_value |
| 2347312 | 26674 | alloc | aster_fn_fact |
| 2294464 | 71702 | alloc | aster_fn_push_token |
| 2292416 | 71638 | alloc | aster_fn_new_parser_at |
| 2264653 | 256356 | concat | aster_fn_json_str |

## generated (467 KiB): query large.aster --file=large.aster --offset=477824

real 0.56 s, user 0.38 s, sys 0.19 s, max RSS 430776 KiB (median of 5)

```text
Flat profile:

Each sample counts as 0.01 seconds.
  %   cumulative   self              self     total           
 time   seconds   seconds    calls  ms/call  ms/call  name    
 46.88      0.15     0.15     7467     0.02     0.03  aster_fn_sha256_block
  9.38      0.18     0.03 50200199     0.00     0.00  aster_rt_array_at
  9.38      0.21     0.03 11114166     0.00     0.00  aster_rt_byte_at
  6.25      0.23     0.02  4300992     0.00     0.00  aster_fn_rotr32
  6.25      0.25     0.02   530592     0.00     0.00  aster_rt_map_slot
  3.12      0.26     0.01  6548211     0.00     0.00  aster_rt_str_eq
  3.12      0.27     0.01  5220878     0.00     0.00  aster_rt_concat
  3.12      0.28     0.01  1161513     0.00     0.00  aster_fn_json_str
  3.12      0.29     0.01   530719     0.00     0.00  map_find
  3.12      0.30     0.01   305290     0.00     0.00  aster_rt_array_new
  3.12      0.31     0.01    45005     0.00     0.00  aster_fn_check_expr_node
  3.12      0.32     0.01        1    10.00    10.00  aster_fn_sha256_new
  0.00      0.32     0.00  5821180     0.00     0.00  aster_rt_len
  0.00      0.32     0.00  2446472     0.00     0.00  aster_rt_alloc
  0.00      0.32     0.00  2131876     0.00     0.00  aster_rt_substring
  0.00      0.32     0.00   921478     0.00     0.00  aster_rt_array_push_slot
  0.00      0.32     0.00   525924     0.00     0.00  aster_fn_json_field_value
  0.00      0.32     0.00   477888     0.00     0.00  aster_fn_padded_byte
  0.00      0.32     0.00   390096     0.00     0.00  aster_rt_int_to_string
  0.00      0.32     0.00   170085     0.00     0.00  aster_fn_advance
```

total 559888865 bytes requested
| Bytes | Calls | Kind | Caller |
| ---: | ---: | --- | --- |
| 186810329 | 430378 | concat | aster_fn_json_join |
| 78346991 | 430378 | concat | aster_fn_json_join |
| 31563271 | 115093 | concat | aster_fn_json_object |
| 31448178 | 115093 | concat | aster_fn_json_object |
| 31126528 | 30184 | alloc | map_rebuild |
| 30922754 | 525424 | concat | aster_fn_json_kv |
| 11660448 | 485852 | alloc | aster_fn_json_field_value |
| 11174896 | 220171 | alloc | aster_rt_array_new |
| 10177088 | 1161513 | concat | aster_fn_json_str |
| 9769312 | 305291 | alloc | aster_rt_array_new |
| 9015575 | 1161513 | concat | aster_fn_json_str |
| 8120292 | 5017 | concat | aster_fn_json_array |
| 8115275 | 5017 | concat | aster_fn_json_array |
| 6001680 | 300084 | itos | aster_fn_json_int |
| 5442816 | 170088 | alloc | aster_fn_push_token |

