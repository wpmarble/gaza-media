#!/bin/zsh

# setopt +o nomatch

# Define codebooks
typeset -A story_codes
story_codes=(
  B1 "famine"
  B2 "hospital"
  B3 "October7"
)

typeset -A perspective_codes
perspective_codes=(
  P "palestinian"
  I "israeli"
)

typeset -A frame_codes
frame_codes=(
  H "humanizing"
  I "infrastructure"
  M "military"
)

# Loop over files in current directory (excluding hidden ones like .DS_Store)
for file in B*.*.*.*(N); do
  # Extract the base filename (without extension)
  base="${file%.*}"
  ext="${file##*.}"

  # Split the base into components
  IFS='.' read story_code perspective_code frame_code <<< "$base"

  # Get full names from codebooks
  story="${story_codes[$story_code]}"
  perspective="${perspective_codes[$perspective_code]}"
  frame="${frame_codes[$frame_code]}"

  # Skip if any component is missing from the map
  if [[ -z "$story" || -z "$perspective" || -z "$frame" ]]; then
    echo "Skipping unrecognized code in file: $file"
    continue
  fi

  # Construct the new filename
  new_name="${story}_${perspective}_${frame}.${ext}"

  # Rename the file
  echo "Renaming: $file --> $new_name"
  mv -- "$file" "$new_name"
done