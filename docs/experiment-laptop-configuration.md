# Experiment Laptop Configuration

| Parameter | Value |
| --- | --- |
| Laptop model | MacBook Pro (MacBookPro18,3) |
| Processor model | Apple M1 Pro |
| Physical cores | 8: 6 performance cores + 2 efficiency cores |
| Logical threads | 8 |
| Base clock frequency (GHz) | Not reported by macOS; unverified |
| Main memory size | 16 GB |
| Main memory type | LPDDR5 unified memory |
| Operating system and version | macOS 27.0 (build 26A428) |
| Java version (active terminal) | Oracle Java 11.0.19 LTS |
| Java runtime build | 11.0.19+9-LTS-224 |
| Java VM | Java HotSpot 64-Bit Server VM |

| Cache | Size per instance | Number of instances | Associativity |
| --- | --- | --- | --- |
| L1 instruction — performance cores | 192 KiB | 6 (one per core) | Not reported by macOS; unverified |
| L1 data — performance cores | 128 KiB | 6 (one per core) | Not reported by macOS; unverified |
| L1 instruction — efficiency cores | 128 KiB | 2 (one per core) | Not reported by macOS; unverified |
| L1 data — efficiency cores | 64 KiB | 2 (one per core) | Not reported by macOS; unverified |
| L2 — performance cores | 12 MiB | 2 (each shared by 3 active cores) | Not reported by macOS; unverified |
| L2 — efficiency cores | 4 MiB | 1 (shared by 2 cores) | Not reported by macOS; unverified |
| L3 | Not reported by macOS | Not reported by macOS | Not reported by macOS; unverified |

Cache sizes and L2 sharing are based on macOS `sysctl`; an unreported L3 does not establish the absence of a system-level cache. KiB = 1,024 bytes; MiB = 1,048,576 bytes.
