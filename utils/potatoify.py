#!/usr/bin/env python3
"""
DDLC Tizen PNG Potatoifier - Fast Python Multiprocessing Edition

Usage:
    python potatoify.py [PROJECT_ROOT] [PROFILE] [WORKERS]

Profiles:
    mild        - 512 colors, light compression
    nuclear     - 32 colors, aggressive compression
    apocalypse  - 16 colors, extremely aggressive compression
    thumbnail   - 16 colors + 50% resize, may break alignment

Examples:
    python potatoify.py .
    python potatoify.py . nuclear
    python potatoify.py . apocalypse 12

Notes:
    - game.zip is NOT touched.
    - game/ is backed up to game.backup-before-potato if no backup exists.
    - PNGs are processed in parallel.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import multiprocessing
import os
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Profile:
    colors: int
    pngquant_quality: str
    resize: str | None


PROFILES: dict[str, Profile] = {
    "mild": Profile(
        colors=645,
        pngquant_quality="10-15",
        resize=None,
    ),
    "nuclear": Profile(
        colors=32,
        pngquant_quality="10-45",
        resize=None,
    ),
    "apocalypse": Profile(
        colors=16,
        pngquant_quality="0-30",
        resize=None,
    ),
    "thumbnail": Profile(
        colors=16,
        pngquant_quality="0-25",
        resize="50%",
    ),
}


@dataclass
class Result:
    path: str
    ok: bool
    old_size: int = 0
    new_size: int = 0
    saved: int = 0
    message: str = ""


def die(message: str, code: int = 1) -> None:
    print(f"[!] {message}", file=sys.stderr)
    raise SystemExit(code)


def need_cmd(command: str) -> None:
    if shutil.which(command) is None:
        die(f"Missing dependency: {command}")


def human_size(size: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(size)

    for unit in units:
        if value < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(value)} {unit}"
            return f"{value:.2f} {unit}"
        value /= 1024

    return f"{size} B"


def dir_size(path: Path) -> int:
    total = 0

    for root, _, files in os.walk(path):
        root_path = Path(root)
        for name in files:
            file_path = root_path / name
            try:
                total += file_path.stat().st_size
            except OSError:
                pass

    return total


def find_pngs(game_dir: Path) -> list[Path]:
    pngs: list[Path] = []

    for root, _, files in os.walk(game_dir):
        root_path = Path(root)
        for name in files:
            if name.lower().endswith(".png"):
                pngs.append(root_path / name)

    return pngs


def run_command(
    args: list[str],
    *,
    quiet: bool = True,
    check: bool = False,
) -> subprocess.CompletedProcess:
    stdout = subprocess.DEVNULL if quiet else None
    stderr = subprocess.DEVNULL if quiet else None

    return subprocess.run(
        args,
        stdout=stdout,
        stderr=stderr,
        check=check,
    )


def process_png(
    file_path_str: str,
    profile_name: str,
    colors: int,
    pngquant_quality: str,
    resize: str | None,
) -> Result:
    file_path = Path(file_path_str)

    try:
        old_size = file_path.stat().st_size
    except OSError as exc:
        return Result(
            path=file_path_str,
            ok=False,
            message=f"Could not stat file: {exc}",
        )

    temp_dir = file_path.parent

    tmp1_handle = tempfile.NamedTemporaryFile(
        prefix=f".{file_path.name}.magick.",
        suffix=".png",
        dir=temp_dir,
        delete=False,
    )
    tmp2_handle = tempfile.NamedTemporaryFile(
        prefix=f".{file_path.name}.pngquant.",
        suffix=".png",
        dir=temp_dir,
        delete=False,
    )

    tmp1 = Path(tmp1_handle.name)
    tmp2 = Path(tmp2_handle.name)

    tmp1_handle.close()
    tmp2_handle.close()

    # We want the tools to create these paths themselves.
    # NamedTemporaryFile already created them, so remove first.
    tmp1.unlink(missing_ok=True)
    tmp2.unlink(missing_ok=True)

    try:
        magick_cmd = ["magick", str(file_path)]

        if resize:
            magick_cmd += ["-resize", resize]

        magick_cmd += [
            "-strip",
            "-colors",
            str(colors),
            f"PNG8:{tmp1}",
        ]

        run_command(magick_cmd, quiet=True, check=True)

        pngquant_cmd = [
            "pngquant",
            "--force",
            "--strip",
            "--speed",
            "1",
            "--quality",
            pngquant_quality,
            "--output",
            str(tmp2),
            "--",
            str(tmp1),
        ]

        pngquant_ok = False

        try:
            completed = run_command(pngquant_cmd, quiet=True, check=False)
            pngquant_ok = completed.returncode == 0 and tmp2.exists()
        except Exception:
            pngquant_ok = False

        candidates: list[Path] = []

        if tmp1.exists():
            candidates.append(tmp1)

        if pngquant_ok and tmp2.exists():
            candidates.append(tmp2)

        if not candidates:
            return Result(
                path=file_path_str,
                ok=False,
                old_size=old_size,
                message="No output file was produced",
            )

        best = min(candidates, key=lambda p: p.stat().st_size)
        best_size = best.stat().st_size

        # Only replace with a smaller result.
        # This matches the spirit of the bash script, but avoids making a file bigger.
        if best_size < old_size:
            os.replace(best, file_path)

            try:
                run_command(
                    ["optipng", "-o7", "-strip", "all", str(file_path)],
                    quiet=True,
                    check=False,
                )
            except Exception:
                pass

            try:
                new_size = file_path.stat().st_size
            except OSError:
                new_size = best_size

            return Result(
                path=file_path_str,
                ok=True,
                old_size=old_size,
                new_size=new_size,
                saved=max(0, old_size - new_size),
                message="optimized",
            )

        return Result(
            path=file_path_str,
            ok=True,
            old_size=old_size,
            new_size=old_size,
            saved=0,
            message="kept original; optimized result was not smaller",
        )

    except subprocess.CalledProcessError as exc:
        return Result(
            path=file_path_str,
            ok=False,
            old_size=old_size,
            message=f"Command failed with exit code {exc.returncode}",
        )

    except Exception as exc:
        return Result(
            path=file_path_str,
            ok=False,
            old_size=old_size,
            message=str(exc),
        )

    finally:
        tmp1.unlink(missing_ok=True)
        tmp2.unlink(missing_ok=True)


def print_biggest_files(game_dir: Path, limit: int = 30) -> None:
    files: list[tuple[int, Path]] = []

    for root, _, names in os.walk(game_dir):
        root_path = Path(root)
        for name in names:
            path = root_path / name
            try:
                files.append((path.stat().st_size, path))
            except OSError:
                pass

    files.sort(reverse=True, key=lambda item: item[0])

    for size, path in files[:limit]:
        print(f"    {human_size(size):>10}  {path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fast multiprocessing PNG potatoifier for DDLC Tizen projects."
    )

    parser.add_argument(
        "project_root",
        nargs="?",
        default=".",
        help="Project root containing game/",
    )

    parser.add_argument(
        "profile",
        nargs="?",
        default="nuclear",
        choices=sorted(PROFILES.keys()),
        help="Compression profile",
    )

    parser.add_argument(
        "workers",
        nargs="?",
        type=int,
        default=None,
        help="Worker count. Defaults to CPU count.",
    )

    return parser.parse_args()


def main() -> int:
    args = parse_args()

    project_root = Path(args.project_root).resolve()
    profile_name = args.profile
    profile = PROFILES[profile_name]

    game_dir = project_root / "game"
    backup_dir = project_root / "game.backup-before-potato"

    workers = args.workers or multiprocessing.cpu_count()
    workers = max(1, workers)

    print("[*] DDLC Tizen PNG potatoifier")
    print(f"[*] Project: {project_root}")
    print(f"[*] Profile: {profile_name}")
    print(f"[*] Workers: {workers}")
    print("[*] game.zip will NOT be touched.")

    need_cmd("magick")
    need_cmd("pngquant")
    need_cmd("optipng")

    if not game_dir.is_dir():
        die(f"Missing game dir: {game_dir}")

    if not backup_dir.exists():
        print(f"[*] Backing up game/ to {backup_dir}")
        shutil.copytree(game_dir, backup_dir, symlinks=True)
    else:
        print("[*] Backup already exists, not overwriting:")
        print(f"    {backup_dir}")

    before_size = dir_size(game_dir)

    pngs = find_pngs(game_dir)

    print("[*] Crunching PNGs...")
    print(f"    PNG files: {len(pngs)}")
    print(f"    Colors: {profile.colors}")
    print(f"    pngquant quality: {profile.pngquant_quality}")

    if profile.resize:
        print(f"    Resize: {profile.resize}")
        print("    WARNING: resize can break sprite/UI alignment.")

    if not pngs:
        print("[*] No PNG files found.")
        return 0

    start = time.time()

    ok_count = 0
    fail_count = 0
    changed_count = 0
    total_saved = 0

    # Larger chunksize lowers multiprocessing overhead when there are tons of files.
    chunksize = max(1, len(pngs) // (workers * 8))

    tasks = [
        (
            str(path),
            profile_name,
            profile.colors,
            profile.pngquant_quality,
            profile.resize,
        )
        for path in pngs
    ]

    with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(process_png, *task)
            for task in tasks
        ]

        completed = 0

        for future in concurrent.futures.as_completed(futures):
            completed += 1

            try:
                result = future.result()
            except Exception as exc:
                fail_count += 1
                print(f"    [FAIL] worker crashed: {exc}")
                continue

            relative = Path(result.path)
            try:
                relative = relative.relative_to(project_root)
            except ValueError:
                pass

            if result.ok:
                ok_count += 1
                total_saved += result.saved

                if result.saved > 0:
                    changed_count += 1
                    print(
                        f"    [{completed}/{len(pngs)}] "
                        f"{relative} - saved {human_size(result.saved)}"
                    )
            else:
                fail_count += 1
                print(
                    f"    [FAIL] [{completed}/{len(pngs)}] "
                    f"{relative} - {result.message}"
                )

    elapsed = time.time() - start
    after_size = dir_size(game_dir)

    print()
    print("[*] Done.")
    print(f"    Processed OK:   {ok_count}")
    print(f"    Changed files:  {changed_count}")
    print(f"    Failed files:   {fail_count}")
    print(f"    Total saved:    {human_size(total_saved)}")
    print(f"    Elapsed:        {elapsed:.2f} seconds")
    print(f"    game/ before:   {human_size(before_size)}")
    print(f"    game/ after:    {human_size(after_size)}")

    if before_size > 0:
        reduction = ((before_size - after_size) / before_size) * 100
        print(f"    Reduction:      {reduction:.2f}%")

    print()
    print("[*] Biggest remaining files:")
    print_biggest_files(game_dir, limit=30)

    print()
    print("[*] game.zip was left untouched.")

    return 0 if fail_count == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
